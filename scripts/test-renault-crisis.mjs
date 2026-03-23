#!/usr/bin/env node

/**
 * Renault Crisis Monitor — Standalone dry-run test
 *
 * Tests all 25 GDELT queries WITHOUT Redis. Outputs results to console + JSON file.
 * Uses 10s delay between requests to respect GDELT rate limits.
 *
 * Usage: node scripts/test-renault-crisis.mjs
 * Optional: node scripts/test-renault-crisis.mjs --limit 5  (only first N queries)
 */

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const INTER_QUERY_DELAY_MS = 10_000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Parse --limit argument
const limitArg = process.argv.indexOf('--limit');
const QUERY_LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// ─── All 25 queries ──────────────────────────────────────────────────────────

const QUERIES = [
  { id: 'labor-layoffs', label: 'Mass layoffs & restructuring', query: '(Renault OR "groupe Renault") (licenciement OR "plan social" OR restructuration OR "suppression postes" OR "fermeture usine")', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '3d' },
  { id: 'labor-strikes', label: 'Strikes & industrial action', query: 'Renault (grève OR blocage OR manifestation OR débrayage OR piquet)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '3d' },
  { id: 'labor-unions', label: 'Union conflict & negotiations', query: 'near10:"Renault syndicat" OR near10:"Renault CGT" OR near10:"Renault CFDT" OR near10:"Renault négociation"', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '3d' },
  { id: 'labor-conditions', label: 'Working conditions & safety', query: 'Renault (accident OR "conditions travail" OR "risques psychosociaux" OR harcèlement OR suicide OR souffrance)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '7d' },
  { id: 'labor-plant-closures', label: 'Plant closure threats', query: 'Renault (Flins OR Maubeuge OR Douai OR Sandouville OR Cléon OR Batilly) (fermeture OR menace OR avenir OR plan)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '7d' },
  { id: 'finance-distress', label: 'Financial distress signals', query: 'Renault (pertes OR déficit OR dette OR "chiffre affaires" OR "résultats financiers" OR "avertissement bénéfices" OR faillite)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '3d' },
  { id: 'finance-stock-crash', label: 'Stock crash & market reaction', query: 'Renault (bourse OR "chute action" OR "cours action" OR "valeur boursière" OR CAC40 OR dégradation OR notation)', mode: 'artlist', maxrecords: 75, timespan: '3d' },
  { id: 'finance-alliance', label: 'Alliance partner crisis', query: '(Renault Nissan) OR (Renault Mitsubishi) OR ("Alliance Renault") (crise OR rupture OR conflit OR séparation OR dissolution OR restructuration)', mode: 'artlist', maxrecords: 75, timespan: '3d' },
  { id: 'finance-shareholders', label: 'Investor / shareholder activism', query: 'Renault (actionnaire OR investisseur OR "assemblée générale" OR gouvernance OR "conseil administration" OR "vote contre")', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '7d' },
  { id: 'legal-emissions', label: 'Emissions fraud / Dieselgate', query: 'Renault (émissions OR diesel OR "logiciel truqueur" OR "dispositif frauduleux" OR "norme pollution" OR homologation OR fraude)', mode: 'artlist', maxrecords: 75, timespan: '3d' },
  { id: 'legal-proceedings', label: 'Legal proceedings & lawsuits', query: 'Renault (procès OR "mise en examen" OR tribunal OR plainte OR condamnation OR amende OR "action justice" OR poursuite)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '7d' },
  { id: 'legal-government', label: 'Government & regulatory intervention', query: 'Renault ("État actionnaire" OR gouvernement OR ministère OR "aide publique" OR subvention OR contrepartie OR régulation)', mode: 'artlist', maxrecords: 75, sourcelang: 'french', timespan: '7d' },
  { id: 'legal-ghosn', label: 'Carlos Ghosn / Executive scandal', query: '(Renault OR Nissan) ("Carlos Ghosn" OR Ghosn) (procès OR scandale OR fuite OR extradition OR enquête)', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'product-recalls', label: 'Vehicle recalls', query: 'Renault (rappel OR "rappel véhicules" OR "défaut fabrication" OR "problème sécurité" OR "campagne rappel")', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'product-accidents', label: 'Accidents involving Renault', query: 'near15:"Renault accident" OR (Renault (EuroNCAP OR "crash test" OR "sécurité routière" OR mortel))', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'product-ev-fires', label: 'EV battery / fire / safety', query: '(Renault OR Megane OR Scenic OR R5 OR Twingo) (batterie OR incendie OR "prend feu" OR explosion OR surchauffe OR "risque incendie")', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'product-cyber', label: 'Software / connected car vulnerabilities', query: 'Renault (cyberattaque OR piratage OR "faille sécurité" OR "données personnelles" OR RGPD OR "vie privée" OR hack)', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'geo-supply-chain', label: 'Supply chain disruption', query: 'Renault ("chaîne approvisionnement" OR pénurie OR "semi-conducteurs" OR "matières premières" OR logistique OR "rupture stock" OR fournisseur)', mode: 'artlist', maxrecords: 75, timespan: '3d' },
  { id: 'geo-exposure', label: 'Geopolitical exposure', query: 'Renault (Russie OR Turquie OR Maroc OR Roumanie OR Algérie OR Iran) (sanction OR conflit OR embargo OR nationalisation OR retrait)', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'geo-eu-regulation', label: 'European regulatory / tariff threats', query: 'Renault ("normes européennes" OR "Green Deal" OR CAFE OR "taxe carbone" OR tarif OR "droits douane" OR "guerre commerciale")', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'geo-china-competition', label: 'Chinese EV competition', query: 'Renault (BYD OR SAIC OR "voiture chinoise" OR "concurrence chinoise" OR "parts marché" OR "véhicule électrique chinois")', mode: 'artlist', maxrecords: 75, timespan: '7d' },
  { id: 'sentiment-tone-fr', label: 'Negative tone spike (FR)', query: 'repeat2:"Renault"', mode: 'timelinetone', sourcelang: 'french', timespan: '7d', timelinesmooth: 5 },
  { id: 'sentiment-volume-fr', label: 'Coverage volume anomaly (FR)', query: 'repeat2:"Renault"', mode: 'timelinevolraw', sourcelang: 'french', timespan: '7d', timelinesmooth: 5 },
  { id: 'sentiment-intl-spike', label: 'International coverage spike (EN)', query: 'Renault (crisis OR scandal OR recall OR strike OR fraud OR investigation OR layoff OR bankruptcy)', mode: 'timelinevolraw', sourcelang: 'english', timespan: '7d', timelinesmooth: 5 },
  { id: 'sentiment-global-sweep', label: 'Global multi-language sweep', query: 'Renault (crisis OR scandal OR recall OR strike OR fraud OR investigation)', mode: 'artlist', maxrecords: 250, timespan: '1d' },
];

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchQuery(q) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set('query', q.query);
  url.searchParams.set('mode', q.mode);
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', q.timespan || '3d');
  if (q.maxrecords) url.searchParams.set('maxrecords', String(q.maxrecords));
  if (q.sourcelang) url.searchParams.set('sourcelang', q.sourcelang);
  if (q.timelinesmooth) url.searchParams.set('TIMELINESMOOTH', String(q.timelinesmooth));

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    // GDELT sometimes returns HTML/text error pages even with 200 status
    if (text.includes('Queries co') || text.includes('rate') || text.includes('limit')) {
      throw new Error('429 rate-limited (non-JSON response)');
    }
    throw new Error(`Invalid JSON: ${text.slice(0, 60)}`);
  }
}

async function fetchWithRetry(q, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchQuery(q);
    } catch (err) {
      const is429 = err.message?.includes('429');
      if (!is429 || attempt === maxRetries) {
        return { error: err.message };
      }
      const backoff = 20_000 + attempt * 15_000;
      console.log(`    ⚠️  429 rate-limited, waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const queriesToRun = QUERIES.slice(0, QUERY_LIMIT);
  const totalTime = queriesToRun.length * INTER_QUERY_DELAY_MS / 1000;

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║    🔴 RENAULT CRISIS MONITOR — GDELT Dry Run               ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Queries: ${String(queriesToRun.length).padEnd(4)} / ${QUERIES.length} total                              ║`);
  console.log(`║  Delay:   ${INTER_QUERY_DELAY_MS / 1000}s between requests                          ║`);
  console.log(`║  ETA:     ~${Math.ceil(totalTime / 60)} minutes                                      ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < queriesToRun.length; i++) {
    const q = queriesToRun[i];

    if (i > 0) {
      process.stdout.write(`  ⏳ Waiting ${INTER_QUERY_DELAY_MS / 1000}s...`);
      await sleep(INTER_QUERY_DELAY_MS);
      process.stdout.write(' ✓\n');
    }

    process.stdout.write(`  [${String(i + 1).padStart(2)}/${queriesToRun.length}] ${q.label.padEnd(45)}`);

    const data = await fetchWithRetry(q);

    if (data.error) {
      console.log(`❌ ${data.error}`);
      results.push({ id: q.id, label: q.label, status: 'error', error: data.error, count: 0 });
      continue;
    }

    if (q.mode === 'artlist') {
      const count = data.articles?.length || 0;
      console.log(`✅ ${String(count).padStart(3)} articles`);

      // Show top 3 titles
      if (count > 0) {
        for (const art of (data.articles || []).slice(0, 3)) {
          const title = (art.title || '').slice(0, 80);
          const source = art.domain || '';
          console.log(`        → ${title} [${source}]`);
        }
      }

      results.push({ id: q.id, label: q.label, status: 'ok', count, topArticles: (data.articles || []).slice(0, 5) });
    } else {
      // Timeline data
      const series = data.timeline || [];
      const points = series.flatMap(s => s.data || [s]);
      console.log(`📊 ${String(points.length).padStart(3)} data points`);

      if (points.length > 0) {
        const values = points.map(p => p.value || 0);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const latest = values[values.length - 1];
        console.log(`        → Latest: ${latest?.toFixed?.(2) || latest}, Avg: ${avg.toFixed(2)}`);
      }

      results.push({ id: q.id, label: q.label, status: 'ok', count: points.length, dataPoints: points.slice(-10) });
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(r => r.status === 'ok').length;
  const errors = results.filter(r => r.status === 'error').length;
  const totalArticles = results.reduce((s, r) => s + r.count, 0);

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  📊 RESULTS SUMMARY                                        ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  ✅ Success:  ${String(success).padEnd(4)} queries                                ║`);
  console.log(`║  ❌ Errors:   ${String(errors).padEnd(4)} queries                                ║`);
  console.log(`║  📄 Total:    ${String(totalArticles).padEnd(4)} articles/data points               ║`);
  console.log(`║  ⏱️  Elapsed:  ${elapsed.padEnd(6)}s                                       ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  // Write results to file
  const { writeFileSync } = await import('node:fs');
  const outPath = '/tmp/renault-crisis-results.json';
  writeFileSync(outPath, JSON.stringify({ results, timestamp: new Date().toISOString(), elapsed }, null, 2));
  console.log(`\n  📁 Full results written to: ${outPath}\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
