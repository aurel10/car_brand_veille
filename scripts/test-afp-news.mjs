#!/usr/bin/env node

/**
 * AFP Wire News — Standalone dry-run test
 *
 * Tests AFP queries WITHOUT Redis. Outputs results to console + JSON file.
 * Requires AFP credentials in environment or .env.local.
 *
 * Usage: node scripts/test-afp-news.mjs
 * Optional: node scripts/test-afp-news.mjs --limit 3  (only first N queries)
 */

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present
try {
  const envPath = resolve(__dirname, '..', '.env.local');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local, rely on environment */ }

const AFP_API_BASE = 'https://afp-apicore-prod.afp.com';
const INTER_QUERY_DELAY_MS = 2_000;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Parse --limit argument
const limitArg = process.argv.indexOf('--limit');
const QUERY_LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// ─── AFP OAuth (inline, no external dependency for standalone test) ──────────

let cachedToken = null;

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.accessToken;

  const clientId = (process.env.AFP_CLIENT_ID || '').trim();
  const clientSecret = (process.env.AFP_CLIENT_SECRET || '').trim();
  const username = (process.env.AFP_USERNAME || '').trim();
  const password = (process.env.AFP_PASSWORD || '').trim();

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Missing AFP credentials. Set AFP_CLIENT_ID, AFP_CLIENT_SECRET, AFP_USERNAME, AFP_PASSWORD');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  const resp = await fetch(`${AFP_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AFP OAuth failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('AFP OAuth: no access_token in response');

  const expiresIn = data.expires_in || 3600;
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (expiresIn * 1000) - 60_000 };
  return cachedToken.accessToken;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

const QUERIES = [
  { id: 'afp-labor-unrest', label: 'Strikes, layoffs & restructuring', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', in: ['Renault', 'Dacia', 'Alpine'] }, { name: 'news', in: ['grève', 'licenciement', 'restructuration', 'plan social'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-labor-plants', label: 'Plant closures & workforce', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['Douai', 'Maubeuge', 'Sandouville', 'usine', 'fermeture', 'emploi'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-finance-results', label: 'Financial results & market', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['résultats', 'bénéfice', 'perte', 'Bourse', 'cours', 'action'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-finance-alliance', label: 'Nissan alliance', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'entity_company', and: ['Nissan'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-legal-emissions', label: 'Emissions fraud & dieselgate', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['émissions', 'diesel', 'fraude', 'pollution'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-legal-proceedings', label: 'Court proceedings & lawsuits', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['procès', 'tribunal', 'enquête', 'amende', 'justice'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-product-recalls', label: 'Vehicle recalls & safety', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', in: ['Renault', 'Dacia'] }, { name: 'news', in: ['rappel', 'défaut', 'sécurité', 'recall', 'safety'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-product-ev', label: 'EV & electric vehicles', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['électrique', 'batterie', 'EV', 'hybride', 'recharge'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-geo-industry', label: 'Auto industry & competition', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'keyword', in: ['automobile', 'industrie'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-geo-tariffs', label: 'EU regulation & tariffs', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['tarif', 'douane', 'réglementation', 'UE', 'taxe', 'norme'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
  { id: 'afp-sentiment-all', label: 'All Renault coverage',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 100 },
  { id: 'afp-sentiment-crisis', label: 'Crisis & controversy coverage', lang: 'fr',
    query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['crise', 'scandale', 'polémique', 'controverse', 'critique'] }] },
    dateRange: { from: 'now-7d', to: 'now' }, maxRows: 100 },
];

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchQuery(q, token) {
  const searchUrl = `${AFP_API_BASE}/v1/api/search`;

  const resp = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': CHROME_UA,
    },
    body: JSON.stringify({
      dateRange: q.dateRange,
      sortOrder: 'desc',
      sortField: 'published',
      maxRows: String(q.maxRows || 50),
      ...(q.lang ? { lang: q.lang } : {}),
      query: q.query,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || data.error.error_type);
  return data.response?.docs || [];
}

async function fetchWithRetry(q, token, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchQuery(q, token);
    } catch (err) {
      if (attempt === maxRetries) return { error: err.message };
      const backoff = 5_000 + attempt * 5_000;
      console.log(`    Retry ${attempt + 1}/${maxRetries}, waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const queriesToRun = QUERIES.slice(0, QUERY_LIMIT);
  const totalTime = queriesToRun.length * INTER_QUERY_DELAY_MS / 1000;

  console.log(`\n+--------------------------------------------------------------+`);
  console.log(`|    AFP WIRE NEWS -- Renault Crisis Dry Run                    |`);
  console.log(`+--------------------------------------------------------------+`);
  console.log(`|  Queries: ${String(queriesToRun.length).padEnd(4)} / ${QUERIES.length} total                              |`);
  console.log(`|  Delay:   ${INTER_QUERY_DELAY_MS / 1000}s between requests                           |`);
  console.log(`|  ETA:     ~${Math.ceil(totalTime / 60)} minutes                                       |`);
  console.log(`+--------------------------------------------------------------+\n`);

  // Authenticate
  console.log('  Authenticating with AFP...');
  let token;
  try {
    token = await getToken();
    console.log('  Authentication successful\n');
  } catch (err) {
    console.error(`  Authentication FAILED: ${err.message}`);
    process.exit(1);
  }

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < queriesToRun.length; i++) {
    const q = queriesToRun[i];

    if (i > 0) {
      process.stdout.write(`  Waiting ${INTER_QUERY_DELAY_MS / 1000}s...`);
      await sleep(INTER_QUERY_DELAY_MS);
      process.stdout.write(' ok\n');
    }

    process.stdout.write(`  [${String(i + 1).padStart(2)}/${queriesToRun.length}] ${q.label.padEnd(45)}`);

    const data = await fetchWithRetry(q, token);

    if (data?.error) {
      console.log(`FAIL ${data.error}`);
      results.push({ id: q.id, label: q.label, status: 'error', error: data.error, count: 0 });
      continue;
    }

    const docs = Array.isArray(data) ? data : [];
    const count = docs.length;
    console.log(`${String(count).padStart(3)} articles`);

    // Show top 3 titles
    if (count > 0) {
      for (const doc of docs.slice(0, 3)) {
        const title = (doc.title || doc.headline || '').slice(0, 80);
        const urgency = String(doc.urgency || '4');
        const urgLabel = urgency === '1' ? 'FLASH' : urgency === '2' ? 'ALERT' : urgency === '3' ? 'URGENT' : '';
        console.log(`        ${urgLabel ? `[${urgLabel}] ` : ''}${title}`);
      }
    }

    results.push({ id: q.id, label: q.label, status: 'ok', count, topDocs: docs.slice(0, 5) });
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(r => r.status === 'ok').length;
  const errors = results.filter(r => r.status === 'error').length;
  const totalArticles = results.reduce((s, r) => s + r.count, 0);

  console.log(`\n+--------------------------------------------------------------+`);
  console.log(`|  RESULTS SUMMARY                                             |`);
  console.log(`+--------------------------------------------------------------+`);
  console.log(`|  Success:  ${String(success).padEnd(4)} queries                                |`);
  console.log(`|  Errors:   ${String(errors).padEnd(4)} queries                                |`);
  console.log(`|  Total:    ${String(totalArticles).padEnd(4)} articles                                |`);
  console.log(`|  Elapsed:  ${elapsed.padEnd(6)}s                                       |`);
  console.log(`+--------------------------------------------------------------+`);

  // Write results to file
  const outPath = '/tmp/afp-renault-results.json';
  writeFileSync(outPath, JSON.stringify({ results, timestamp: new Date().toISOString(), elapsed }, null, 2));
  console.log(`\n  Full results written to: ${outPath}\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
