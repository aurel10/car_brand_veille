#!/usr/bin/env node

/**
 * AFP Wire News — Renault Crisis Monitoring seed script
 *
 * Fetches 12 AFP queries across 6 threat categories:
 *   1. Labor & Social Unrest (2 queries)
 *   2. Financial & Market (2 queries)
 *   3. Legal & Regulatory (2 queries)
 *   4. Product Safety & Quality (2 queries)
 *   5. Geopolitical & Supply Chain (2 queries)
 *   6. Sentiment & Reputation (2 queries)
 *
 * Rate-limit strategy: 2s between each request (AFP allows 5000/hr).
 * Token retry: on 401, clear cached token, re-authenticate once, and retry.
 */

import { loadEnvFile, CHROME_UA, runSeed, sleep } from './_seed-utils.mjs';
import { getAfpToken, clearAfpTokenCache } from './shared/afp-oauth.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:afp-renault:v1';
const CACHE_TTL = 21600; // 6h
const AFP_API_BASE = 'https://afp-apicore-prod.afp.com';
const INTER_QUERY_DELAY_MS = 2_000; // 2s between queries (5000/hr = ~1.4/sec)

// ─── Priority tiers ─────────────────────────────────────────────────────────
const PRIORITY = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

// ─── 12 AFP Crisis Monitoring Queries ────────────────────────────────────────

const AFP_QUERIES = [
  // ──────────── Category 1: Labor & Social Unrest ────────────
  {
    id: 'afp-labor-unrest',
    category: 'labor',
    priority: PRIORITY.CRITICAL,
    label: 'Strikes, layoffs & restructuring',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', in: ['Renault', 'Dacia', 'Alpine'] },
        { name: 'news', in: ['grève', 'licenciement', 'restructuration', 'plan social', 'suppression', 'débrayage'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },
  {
    id: 'afp-labor-plants',
    category: 'labor',
    priority: PRIORITY.HIGH,
    label: 'Plant closures & workforce',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['Douai', 'Maubeuge', 'Sandouville', 'Cléon', 'Batilly', 'Flins', 'usine', 'fermeture', 'emploi'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },

  // ──────────── Category 2: Financial & Market ────────────
  {
    id: 'afp-finance-results',
    category: 'financial',
    priority: PRIORITY.CRITICAL,
    label: 'Financial results & market',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['résultats', 'bénéfice', 'perte', 'chiffre', 'Bourse', 'cours', 'action', 'dividende'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },
  {
    id: 'afp-finance-alliance',
    category: 'financial',
    priority: PRIORITY.HIGH,
    label: 'Nissan alliance',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'entity_company', and: ['Nissan'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },

  // ──────────── Category 3: Legal & Regulatory ────────────
  {
    id: 'afp-legal-emissions',
    category: 'legal',
    priority: PRIORITY.HIGH,
    label: 'Emissions fraud & dieselgate',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['émissions', 'diesel', 'fraude', 'pollution', 'homologation', 'mise en examen'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },
  {
    id: 'afp-legal-proceedings',
    category: 'legal',
    priority: PRIORITY.MEDIUM,
    label: 'Court proceedings & lawsuits',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['procès', 'tribunal', 'enquête', 'amende', 'condamnation', 'justice', 'plainte'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },

  // ──────────── Category 4: Product Safety & Quality ────────────
  {
    id: 'afp-product-recalls',
    category: 'product',
    priority: PRIORITY.HIGH,
    label: 'Vehicle recalls & safety defects',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', in: ['Renault', 'Dacia'] },
        { name: 'news', in: ['rappel', 'défaut', 'sécurité', 'recall', 'defect', 'safety'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },
  {
    id: 'afp-product-ev-battery',
    category: 'product',
    priority: PRIORITY.HIGH,
    label: 'EV & electric vehicles',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['électrique', 'batterie', 'EV', 'hybride', 'recharge'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },

  // ──────────── Category 5: Geopolitical & Supply Chain ────────────
  {
    id: 'afp-geo-industry',
    category: 'geopolitical',
    priority: PRIORITY.HIGH,
    label: 'Auto industry & competition',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'keyword', in: ['automobile', 'industrie'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },
  {
    id: 'afp-geo-tariffs',
    category: 'geopolitical',
    priority: PRIORITY.MEDIUM,
    label: 'EU regulation & tariffs',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['tarif', 'douane', 'réglementation', 'UE', 'taxe', 'norme'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 50,
  },

  // ──────────── Category 6: Sentiment & Reputation ────────────
  {
    id: 'afp-sentiment-all',
    category: 'sentiment',
    priority: PRIORITY.MEDIUM,
    label: 'All Renault coverage',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 100,
  },
  {
    id: 'afp-sentiment-crisis',
    category: 'sentiment',
    priority: PRIORITY.MEDIUM,
    label: 'Crisis & controversy coverage',
    lang: 'fr',
    query: {
      and: [
        { name: 'class', and: ['text'] },
        { name: 'entity_company', and: ['Renault'] },
        { name: 'news', in: ['crise', 'scandale', 'polémique', 'controverse', 'colère', 'critique'] },
      ],
    },
    dateRange: { from: 'now-7d', to: 'now' },
    maxRows: 100,
  },
];

// ─── AFP API helpers ─────────────────────────────────────────────────────────

function buildAfpSearchBody(queryDef) {
  const body = {
    dateRange: queryDef.dateRange,
    sortOrder: 'desc',
    sortField: 'published',
    maxRows: String(queryDef.maxRows || 50),
    query: queryDef.query,
  };
  if (queryDef.lang) body.lang = queryDef.lang;
  return body;
}

function normalizeAfpArticle(doc) {
  const title = String(doc.title || doc.headline || '').slice(0, 500);
  if (!title) return null;

  // AFP docs may not have a public URL; use href or construct from uno
  const url = doc.href || (doc.uno ? `https://www.afp.com/doc/${doc.uno}` : '');

  // AFP urgency: "1"=Flash, "2"=Alert, "3"=Urgent, "4"=Lead (strings)
  const rawUrgency = String(doc.urgency || '4');
  const urgency = parseInt(rawUrgency, 10) || 4;

  return {
    title,
    url,
    source: 'AFP',
    date: String(doc.published || doc.created || ''),
    image: doc.bagItem?.[0]?.medias?.href || '',
    language: String(doc.lang || doc.language || ''),
    tone: 0, // AFP does not provide tone scores
    urgency,
    iptcCodes: Array.isArray(doc.iptc) ? doc.iptc.map(c => c.code || c) : [],
    slug: String(doc.slug || ''),
    afpId: String(doc.uno || doc.guid || doc.id || ''),
    country: doc.country || doc.countryname || '',
    product: String(doc.product || doc.class || 'text'),
    abstract: String(doc.abstract || ''),
  };
}

// ─── AFP fetcher ────────────────────────────────────────────────────────────

async function fetchAfpQuery(queryDef, token) {
  const searchUrl = `${AFP_API_BASE}/v1/api/search`;
  const body = JSON.stringify(buildAfpSearchBody(queryDef));

  const resp = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': CHROME_UA,
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  if (resp.status === 401) {
    throw Object.assign(new Error(`AFP ${queryDef.id}: HTTP 401 Unauthorized`), { status: 401 });
  }

  if (!resp.ok) {
    throw new Error(`AFP ${queryDef.id}: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  // AFP response: { response: { status: { code, reason }, docs: [...] } }
  if (data.error) {
    throw new Error(`AFP ${queryDef.id}: ${data.error.message || data.error.error_type}`);
  }

  const docs = data.response?.docs || [];
  const articles = docs.map(normalizeAfpArticle).filter(Boolean);

  return {
    id: queryDef.id,
    category: queryDef.category,
    priority: queryDef.priority,
    label: queryDef.label,
    lang: queryDef.lang,
    articles,
    articleCount: articles.length,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchWithRetry(queryDef, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const token = await getAfpToken({ userAgent: CHROME_UA });
      if (!token) throw new Error('AFP authentication failed — no token');
      return await fetchAfpQuery(queryDef, token);
    } catch (err) {
      // On 401, clear token cache and retry once
      if (err.status === 401 && attempt === 0) {
        console.log(`    401 on ${queryDef.id}, clearing token cache and retrying...`);
        clearAfpTokenCache();
        continue;
      }

      const isRetryable = err.status === 429 || err.message?.includes('429') || err.message?.includes('503');
      if (!isRetryable || attempt === maxRetries) {
        console.warn(`    ${queryDef.id}: giving up after ${attempt + 1} attempts (${err.message})`);
        return {
          id: queryDef.id,
          category: queryDef.category,
          priority: queryDef.priority,
          label: queryDef.label,
          lang: queryDef.lang,
          articles: [],
          articleCount: 0,
          fetchedAt: new Date().toISOString(),
          error: err.message,
        };
      }

      const backoff = 20_000 + attempt * 15_000;
      console.log(`    Rate-limited on ${queryDef.id}, waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

// ─── Alert detection ─────────────────────────────────────────────────────────

function detectAlerts(results) {
  const alerts = [];

  for (const r of results) {
    // AFP urgency-based alerts: FLASH (1) or ALERT (2) on any article
    if (r.articles?.length) {
      const flashArticles = r.articles.filter(a => a.urgency === 1);
      const urgentArticles = r.articles.filter(a => a.urgency === 2);

      if (flashArticles.length > 0) {
        alerts.push({
          level: 'CRITICAL',
          queryId: r.id,
          label: r.label,
          message: `${flashArticles.length} AFP FLASH dispatch(es): "${flashArticles[0].title.slice(0, 80)}"`,
        });
      }

      if (urgentArticles.length > 0) {
        alerts.push({
          level: 'WARNING',
          queryId: r.id,
          label: r.label,
          message: `${urgentArticles.length} AFP URGENT dispatch(es)`,
        });
      }
    }

    // High volume alerts for sensitive categories
    if (['afp-product-ev', 'afp-legal-emissions'].includes(r.id) && r.articleCount > 0) {
      alerts.push({
        level: 'ALERT',
        queryId: r.id,
        label: r.label,
        message: `${r.articleCount} AFP articles found — review immediately`,
      });
    }
  }

  return alerts;
}

// ─── Main fetch orchestrator ─────────────────────────────────────────────────

async function fetchAllAfpQueries() {
  // Early exit if AFP credentials not configured
  const clientId = (process.env.AFP_CLIENT_ID || '').trim();
  if (!clientId) {
    console.warn('  AFP_CLIENT_ID not set — skipping AFP seed');
    return null;
  }

  const results = [];
  const errors = [];
  const startTime = Date.now();

  console.log(`  Fetching AFP wire news (${AFP_QUERIES.length} queries, ${INTER_QUERY_DELAY_MS / 1000}s delay)\n`);

  for (let i = 0; i < AFP_QUERIES.length; i++) {
    const q = AFP_QUERIES[i];

    if (i > 0) {
      console.log(`    Waiting ${INTER_QUERY_DELAY_MS / 1000}s before next request...`);
      await sleep(INTER_QUERY_DELAY_MS);
    }

    console.log(`  [${i + 1}/${AFP_QUERIES.length}] ${q.label} (${q.id}) [${q.priority}] [${q.lang}]`);

    const result = await fetchWithRetry(q);

    if (result.error) {
      errors.push({ id: q.id, error: result.error });
    }

    console.log(`    ${result.articleCount} articles`);
    results.push(result);
  }

  const alerts = detectAlerts(results);

  if (alerts.length > 0) {
    console.log(`\n  ALERTS DETECTED (${alerts.length}):`);
    for (const alert of alerts) {
      console.log(`    [${alert.level}] ${alert.label}: ${alert.message}`);
    }
  } else {
    console.log(`\n  No crisis alerts triggered`);
  }

  const totalArticles = results.reduce((sum, r) => sum + r.articleCount, 0);

  const categorySummary = {};
  for (const r of results) {
    if (!categorySummary[r.category]) {
      categorySummary[r.category] = { queries: 0, articles: 0, errors: 0 };
    }
    categorySummary[r.category].queries++;
    categorySummary[r.category].articles += r.articleCount;
    if (r.error) categorySummary[r.category].errors++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Summary: ${totalArticles} total articles across ${results.length} queries in ${elapsed}s`);
  for (const [cat, data] of Object.entries(categorySummary)) {
    console.log(`    ${cat}: ${data.queries} queries, ${data.articles} articles${data.errors ? `, ${data.errors} errors` : ''}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ${errors.length} queries had errors: ${errors.map(e => e.id).join(', ')}`);
  }

  return {
    queries: results,
    alerts,
    summary: {
      totalQueries: results.length,
      totalArticles,
      categories: categorySummary,
      errors: errors.length,
      elapsedSeconds: parseFloat(elapsed),
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validate(data) {
  if (!data || !Array.isArray(data?.queries) || data.queries.length === 0) return false;
  // At least 4 queries must return results (out of 12)
  const populated = data.queries.filter(q => q.articleCount > 0);
  return populated.length >= 4;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

runSeed('intelligence', 'afp-renault', CANONICAL_KEY, fetchAllAfpQueries, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'afp-apicore-v2-renault',
  recordCount: (data) => data?.summary?.totalArticles || 0,
}).catch((err) => {
  const _cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
  console.error('FATAL:', (err.message || err) + _cause);
  process.exit(1);
});
