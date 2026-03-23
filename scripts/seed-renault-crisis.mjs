#!/usr/bin/env node

/**
 * Renault Crisis Monitoring — GDELT DOC 2.0 API seed script
 *
 * Fetches 25 crisis monitoring queries across 6 threat categories:
 *   1. Labor & Social Unrest (Q1–Q5)
 *   2. Financial & Market (Q6–Q9)
 *   3. Legal & Regulatory (Q10–Q13)
 *   4. Product Safety & Quality (Q14–Q17)
 *   5. Geopolitical & Supply Chain (Q18–Q21)
 *   6. Sentiment & Reputation Radar (Q22–Q25)
 *
 * Rate-limit strategy: 10s between each request, 20s backoff + exponential on 429.
 * Queries are grouped by priority tier for scheduling.
 */

import { loadEnvFile, CHROME_UA, runSeed, sleep } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'intelligence:renault-crisis:v1';
const CACHE_TTL = 21600; // 6h
const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const INTER_QUERY_DELAY_MS = 10_000; // 10s between queries — strict GDELT rate limit compliance

// ─── Priority tiers ─────────────────────────────────────────────────────────
// CRITICAL = check every 30min (seed cron), HIGH = every 2h, MEDIUM = every 6h, LOW = daily
const PRIORITY = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

// ─── 25 Crisis Monitoring Queries ────────────────────────────────────────────

const RENAULT_CRISIS_QUERIES = [
  // ──────────── Category 1: Labor & Social Unrest (Q1–Q5) ────────────
  {
    id: 'labor-layoffs',
    category: 'labor',
    priority: PRIORITY.CRITICAL,
    label: 'Mass layoffs & restructuring',
    query: '(Renault OR "groupe Renault") (licenciement OR "plan social" OR restructuration OR "suppression postes" OR "fermeture usine")',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '3d',
  },
  {
    id: 'labor-strikes',
    category: 'labor',
    priority: PRIORITY.CRITICAL,
    label: 'Strikes & industrial action',
    query: 'Renault (grève OR blocage OR manifestation OR débrayage OR piquet)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '3d',
  },
  {
    id: 'labor-unions',
    category: 'labor',
    priority: PRIORITY.HIGH,
    label: 'Union conflict & negotiations',
    query: 'near10:"Renault syndicat" OR near10:"Renault CGT" OR near10:"Renault CFDT" OR near10:"Renault négociation"',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '3d',
  },
  {
    id: 'labor-conditions',
    category: 'labor',
    priority: PRIORITY.MEDIUM,
    label: 'Working conditions & safety',
    query: 'Renault (accident OR "conditions travail" OR "risques psychosociaux" OR harcèlement OR suicide OR souffrance)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '7d',
  },
  {
    id: 'labor-plant-closures',
    category: 'labor',
    priority: PRIORITY.HIGH,
    label: 'Plant closure threats',
    query: 'Renault (Flins OR Maubeuge OR Douai OR Sandouville OR Cléon OR Batilly) (fermeture OR menace OR avenir OR plan)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '7d',
  },

  // ──────────── Category 2: Financial & Market (Q6–Q9) ────────────
  {
    id: 'finance-distress',
    category: 'financial',
    priority: PRIORITY.CRITICAL,
    label: 'Financial distress signals',
    query: 'Renault (pertes OR déficit OR dette OR "chiffre affaires" OR "résultats financiers" OR "avertissement bénéfices" OR faillite)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '3d',
  },
  {
    id: 'finance-stock-crash',
    category: 'financial',
    priority: PRIORITY.CRITICAL,
    label: 'Stock crash & market reaction',
    query: 'Renault (bourse OR "chute action" OR "cours action" OR "valeur boursière" OR CAC40 OR dégradation OR notation)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '3d',
  },
  {
    id: 'finance-alliance',
    category: 'financial',
    priority: PRIORITY.HIGH,
    label: 'Alliance partner crisis (Nissan/Mitsubishi)',
    query: '(Renault Nissan) OR (Renault Mitsubishi) OR ("Alliance Renault") (crise OR rupture OR conflit OR séparation OR dissolution OR restructuration)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '3d',
  },
  {
    id: 'finance-shareholders',
    category: 'financial',
    priority: PRIORITY.MEDIUM,
    label: 'Investor / shareholder activism',
    query: 'Renault (actionnaire OR investisseur OR "assemblée générale" OR gouvernance OR "conseil administration" OR "vote contre")',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '7d',
  },

  // ──────────── Category 3: Legal & Regulatory (Q10–Q13) ────────────
  {
    id: 'legal-emissions',
    category: 'legal',
    priority: PRIORITY.HIGH,
    label: 'Emissions fraud / Dieselgate',
    query: 'Renault (émissions OR diesel OR "logiciel truqueur" OR "dispositif frauduleux" OR "norme pollution" OR homologation OR fraude)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '3d',
  },
  {
    id: 'legal-proceedings',
    category: 'legal',
    priority: PRIORITY.MEDIUM,
    label: 'Legal proceedings & lawsuits',
    query: 'Renault (procès OR "mise en examen" OR tribunal OR plainte OR condamnation OR amende OR "action justice" OR poursuite)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '7d',
  },
  {
    id: 'legal-government',
    category: 'legal',
    priority: PRIORITY.MEDIUM,
    label: 'Government & regulatory intervention',
    query: 'Renault ("État actionnaire" OR gouvernement OR ministère OR "aide publique" OR subvention OR contrepartie OR régulation)',
    mode: 'artlist',
    maxrecords: 75,
    sourcelang: 'french',
    timespan: '7d',
  },
  {
    id: 'legal-ghosn',
    category: 'legal',
    priority: PRIORITY.LOW,
    label: 'Carlos Ghosn / Executive scandal',
    query: '(Renault OR Nissan) ("Carlos Ghosn" OR Ghosn) (procès OR scandale OR fuite OR extradition OR enquête)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },

  // ──────────── Category 4: Product Safety & Quality (Q14–Q17) ────────────
  {
    id: 'product-recalls',
    category: 'product',
    priority: PRIORITY.HIGH,
    label: 'Vehicle recalls',
    query: 'Renault (rappel OR "rappel véhicules" OR "défaut fabrication" OR "problème sécurité" OR "campagne rappel")',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },
  {
    id: 'product-accidents',
    category: 'product',
    priority: PRIORITY.MEDIUM,
    label: 'Accidents involving Renault vehicles',
    query: 'near15:"Renault accident" OR (Renault (EuroNCAP OR "crash test" OR "sécurité routière" OR mortel))',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },
  {
    id: 'product-ev-fires',
    category: 'product',
    priority: PRIORITY.HIGH,
    label: 'EV battery / fire / safety',
    query: '(Renault OR Megane OR Scenic OR R5 OR Twingo) (batterie OR incendie OR "prend feu" OR explosion OR surchauffe OR "risque incendie")',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },
  {
    id: 'product-cyber',
    category: 'product',
    priority: PRIORITY.MEDIUM,
    label: 'Software / connected car vulnerabilities',
    query: 'Renault (cyberattaque OR piratage OR "faille sécurité" OR "données personnelles" OR RGPD OR "vie privée" OR hack)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },

  // ──────────── Category 5: Geopolitical & Supply Chain (Q18–Q21) ────────────
  {
    id: 'geo-supply-chain',
    category: 'geopolitical',
    priority: PRIORITY.HIGH,
    label: 'Supply chain disruption',
    query: 'Renault ("chaîne approvisionnement" OR pénurie OR "semi-conducteurs" OR "matières premières" OR logistique OR "rupture stock" OR fournisseur)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '3d',
  },
  {
    id: 'geo-exposure',
    category: 'geopolitical',
    priority: PRIORITY.MEDIUM,
    label: 'Geopolitical exposure (Russia, Turkey, Morocco)',
    query: 'Renault (Russie OR Turquie OR Maroc OR Roumanie OR Algérie OR Iran) (sanction OR conflit OR embargo OR nationalisation OR retrait)',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },
  {
    id: 'geo-eu-regulation',
    category: 'geopolitical',
    priority: PRIORITY.MEDIUM,
    label: 'European regulatory / tariff threats',
    query: 'Renault ("normes européennes" OR "Green Deal" OR CAFE OR "taxe carbone" OR tarif OR "droits douane" OR "guerre commerciale")',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },
  {
    id: 'geo-china-competition',
    category: 'geopolitical',
    priority: PRIORITY.MEDIUM,
    label: 'Chinese EV competition threat',
    query: 'Renault (BYD OR SAIC OR "voiture chinoise" OR "concurrence chinoise" OR "parts marché" OR "véhicule électrique chinois")',
    mode: 'artlist',
    maxrecords: 75,
    timespan: '7d',
  },

  // ──────────── Category 6: Sentiment & Reputation Radar (Q22–Q25) ────────────
  {
    id: 'sentiment-tone-fr',
    category: 'sentiment',
    priority: PRIORITY.CRITICAL,
    label: 'Negative tone spike (French media)',
    query: 'repeat2:"Renault"',
    mode: 'timelinetone',
    sourcelang: 'french',
    timespan: '7d',
    timelinesmooth: 5,
  },
  {
    id: 'sentiment-volume-fr',
    category: 'sentiment',
    priority: PRIORITY.CRITICAL,
    label: 'Coverage volume anomaly (French media)',
    query: 'repeat2:"Renault"',
    mode: 'timelinevolraw',
    sourcelang: 'french',
    timespan: '7d',
    timelinesmooth: 5,
  },
  {
    id: 'sentiment-intl-spike',
    category: 'sentiment',
    priority: PRIORITY.MEDIUM,
    label: 'International coverage spike (English)',
    query: 'Renault (crisis OR scandal OR recall OR strike OR fraud OR investigation OR layoff OR bankruptcy)',
    mode: 'timelinevolraw',
    sourcelang: 'english',
    timespan: '7d',
    timelinesmooth: 5,
  },
  {
    id: 'sentiment-global-sweep',
    category: 'sentiment',
    priority: PRIORITY.LOW,
    label: 'Global multi-language crisis sweep',
    query: 'Renault (crisis OR scandal OR recall OR strike OR fraud OR investigation)',
    mode: 'artlist',
    maxrecords: 250,
    timespan: '1d',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function normalizeArticle(raw) {
  const url = raw.url || '';
  if (!isValidUrl(url)) return null;
  return {
    title: String(raw.title || '').slice(0, 500),
    url,
    source: String(raw.domain || raw.source?.domain || '').slice(0, 200),
    date: String(raw.seendate || ''),
    image: isValidUrl(raw.socialimage || '') ? raw.socialimage : '',
    language: String(raw.language || ''),
    tone: typeof raw.tone === 'number' ? raw.tone : 0,
  };
}

function normalizeTimelineEntry(raw) {
  return {
    date: raw.date || '',
    value: typeof raw.value === 'number' ? raw.value : parseFloat(raw.value) || 0,
  };
}

// ─── GDELT fetcher ───────────────────────────────────────────────────────────

async function fetchQuery(queryDef) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set('query', queryDef.query);
  url.searchParams.set('mode', queryDef.mode);
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', queryDef.timespan || '3d');

  if (queryDef.maxrecords) {
    url.searchParams.set('maxrecords', String(queryDef.maxrecords));
  }
  if (queryDef.sourcelang) {
    url.searchParams.set('sourcelang', queryDef.sourcelang);
  }
  if (queryDef.timelinesmooth) {
    url.searchParams.set('TIMELINESMOOTH', String(queryDef.timelinesmooth));
  }

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) throw new Error(`GDELT ${queryDef.id}: HTTP ${resp.status}`);

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // GDELT sometimes returns HTML/text error pages even with 200 status
    if (text.includes('Queries co') || text.includes('rate') || text.includes('limit')) {
      throw new Error(`GDELT ${queryDef.id}: 429 rate-limited (non-JSON response)`);
    }
    throw new Error(`GDELT ${queryDef.id}: invalid JSON response: ${text.slice(0, 80)}`);
  }

  // Artlist mode returns { articles: [...] }
  if (queryDef.mode === 'artlist') {
    const articles = (data.articles || [])
      .map(normalizeArticle)
      .filter(Boolean);

    return {
      id: queryDef.id,
      category: queryDef.category,
      priority: queryDef.priority,
      label: queryDef.label,
      mode: queryDef.mode,
      articles,
      articleCount: articles.length,
      timeline: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Timeline modes return { timeline: [...] }
  const timeline = (data.timeline || []).flatMap(series => {
    if (series.data) return series.data.map(normalizeTimelineEntry);
    return [normalizeTimelineEntry(series)];
  });

  return {
    id: queryDef.id,
    category: queryDef.category,
    priority: queryDef.priority,
    label: queryDef.label,
    mode: queryDef.mode,
    articles: null,
    articleCount: 0,
    timeline,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchWithRetry(queryDef, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchQuery(queryDef);
    } catch (err) {
      const is429 = err.message?.includes('429');
      if (!is429 || attempt === maxRetries) {
        console.warn(`    ${queryDef.id}: giving up after ${attempt + 1} attempts (${err.message})`);
        return {
          id: queryDef.id,
          category: queryDef.category,
          priority: queryDef.priority,
          label: queryDef.label,
          mode: queryDef.mode,
          articles: queryDef.mode === 'artlist' ? [] : null,
          articleCount: 0,
          timeline: queryDef.mode !== 'artlist' ? [] : null,
          fetchedAt: new Date().toISOString(),
          error: err.message,
        };
      }
      // Exponential backoff starting at 20s
      const backoff = 20_000 + attempt * 15_000;
      console.log(`    429 rate-limited on ${queryDef.id}, waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

// ─── Alert detection ─────────────────────────────────────────────────────────

function detectAlerts(results) {
  const alerts = [];

  for (const r of results) {
    // Timeline tone alerts
    if (r.mode === 'timelinetone' && r.timeline?.length) {
      const recent = r.timeline.slice(-6); // last ~6 intervals
      const avgTone = recent.reduce((sum, t) => sum + t.value, 0) / recent.length;

      if (avgTone < -8) {
        alerts.push({ level: 'CRITICAL', queryId: r.id, label: r.label, message: `Avg tone = ${avgTone.toFixed(2)} (< -8)` });
      } else if (avgTone < -5) {
        alerts.push({ level: 'WARNING', queryId: r.id, label: r.label, message: `Avg tone = ${avgTone.toFixed(2)} (< -5)` });
      }
    }

    // Volume anomaly detection (compare latest vs avg)
    if (r.mode === 'timelinevolraw' && r.timeline?.length > 12) {
      const allValues = r.timeline.map(t => t.value);
      const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
      const latest = allValues.slice(-3).reduce((a, b) => a + b, 0) / 3;

      if (avg > 0 && latest > avg * 3) {
        alerts.push({ level: 'WARNING', queryId: r.id, label: r.label, message: `Volume spike: ${latest.toFixed(0)} vs avg ${avg.toFixed(0)} (${(latest / avg).toFixed(1)}x)` });
      }
    }

    // Immediate alert on high-risk topics with results
    if (['legal-emissions', 'product-ev-fires'].includes(r.id) && r.articleCount > 0) {
      alerts.push({ level: 'ALERT', queryId: r.id, label: r.label, message: `${r.articleCount} articles found — review immediately` });
    }
  }

  return alerts;
}

// ─── Main fetch orchestrator ─────────────────────────────────────────────────

async function fetchAllCrisisQueries() {
  const results = [];
  const errors = [];
  const startTime = Date.now();

  console.log(`  📡 Starting Renault crisis scan (${RENAULT_CRISIS_QUERIES.length} queries, ${INTER_QUERY_DELAY_MS / 1000}s delay)\n`);

  for (let i = 0; i < RENAULT_CRISIS_QUERIES.length; i++) {
    const q = RENAULT_CRISIS_QUERIES[i];

    // Wait between requests (skip first)
    if (i > 0) {
      console.log(`    ⏳ Waiting ${INTER_QUERY_DELAY_MS / 1000}s before next request...`);
      await sleep(INTER_QUERY_DELAY_MS);
    }

    console.log(`  [${i + 1}/${RENAULT_CRISIS_QUERIES.length}] ${q.label} (${q.id}) [${q.priority}]`);

    const result = await fetchWithRetry(q);

    if (result.error) {
      errors.push({ id: q.id, error: result.error });
    }

    const count = result.articleCount || result.timeline?.length || 0;
    console.log(`    ✅ ${count} ${result.mode === 'artlist' ? 'articles' : 'data points'}`);

    results.push(result);
  }

  // Run alert detection
  const alerts = detectAlerts(results);

  if (alerts.length > 0) {
    console.log(`\n  🚨 ALERTS DETECTED (${alerts.length}):`);
    for (const alert of alerts) {
      console.log(`    [${alert.level}] ${alert.label}: ${alert.message}`);
    }
  } else {
    console.log(`\n  ✅ No crisis alerts triggered`);
  }

  // Summary stats
  const totalArticles = results
    .filter(r => r.mode === 'artlist')
    .reduce((sum, r) => sum + r.articleCount, 0);

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
  console.log(`\n  📊 Summary: ${totalArticles} total articles across ${results.length} queries in ${elapsed}s`);
  console.log(`  📊 Category breakdown:`);
  for (const [cat, data] of Object.entries(categorySummary)) {
    console.log(`    ${cat}: ${data.queries} queries, ${data.articles} articles${data.errors ? `, ${data.errors} errors` : ''}`);
  }

  if (errors.length > 0) {
    console.log(`\n  ⚠️  ${errors.length} queries had errors: ${errors.map(e => e.id).join(', ')}`);
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
  if (!Array.isArray(data?.queries) || data.queries.length === 0) return false;
  // At least 10 queries must succeed (out of 25) for the data to be useful
  const populated = data.queries.filter(q =>
    (q.articleCount > 0) || (q.timeline?.length > 0)
  );
  return populated.length >= 10;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

runSeed('intelligence', 'renault-crisis', CANONICAL_KEY, fetchAllCrisisQueries, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'gdelt-doc-v2-renault-crisis',
  recordCount: (data) => data?.summary?.totalArticles || 0,
}).catch((err) => {
  const _cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
  console.error('FATAL:', (err.message || err) + _cause);
  process.exit(1);
});
