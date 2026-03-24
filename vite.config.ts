import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve, dirname, extname } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { brotliCompress } from 'zlib';
import { promisify } from 'util';
import pkg from './package.json';
import { VARIANT_META, type VariantMeta } from './src/config/variant-meta';

// Env-dependent constants moved inside defineConfig function


const brotliCompressAsync = promisify(brotliCompress);
const BROTLI_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.xml', '.wasm']);

function brotliPrecompressPlugin(): Plugin {
  return {
    name: 'brotli-precompress',
    apply: 'build',
    async writeBundle(outputOptions, bundle) {
      const outDir = outputOptions.dir;
      if (!outDir) return;

      await Promise.all(Object.keys(bundle).map(async (fileName) => {
        const extension = extname(fileName).toLowerCase();
        if (!BROTLI_EXTENSIONS.has(extension)) return;

        const sourcePath = resolve(outDir, fileName);
        const compressedPath = `${sourcePath}.br`;
        const sourceBuffer = await readFile(sourcePath);
        if (sourceBuffer.length < 1024) return;

        const compressedBuffer = await brotliCompressAsync(sourceBuffer);
        await mkdir(dirname(compressedPath), { recursive: true });
        await writeFile(compressedPath, compressedBuffer);
      }));
    },
  };
}

function htmlVariantPlugin(activeMeta: VariantMeta, activeVariant: string, isDesktopBuild: boolean): Plugin {
  return {
    name: 'html-variant',
    transformIndexHtml(html) {
      let result = html
        .replace(/<title>.*?<\/title>/, `<title>${activeMeta.title}</title>`)
        .replace(/<meta name="title" content=".*?" \/>/, `<meta name="title" content="${activeMeta.title}" />`)
        .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${activeMeta.description}" />`)
        .replace(/<meta name="keywords" content=".*?" \/>/, `<meta name="keywords" content="${activeMeta.keywords}" />`)
        .replace(/<link rel="canonical" href=".*?" \/>/, `<link rel="canonical" href="${activeMeta.url}" />`)
        .replace(/<meta name="application-name" content=".*?" \/>/, `<meta name="application-name" content="${activeMeta.siteName}" />`)
        .replace(/<meta property="og:url" content=".*?" \/>/, `<meta property="og:url" content="${activeMeta.url}" />`)
        .replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${activeMeta.title}" />`)
        .replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${activeMeta.description}" />`)
        .replace(/<meta property="og:site_name" content=".*?" \/>/, `<meta property="og:site_name" content="${activeMeta.siteName}" />`)
        .replace(/<meta name="subject" content=".*?" \/>/, `<meta name="subject" content="${activeMeta.subject}" />`)
        .replace(/<meta name="classification" content=".*?" \/>/, `<meta name="classification" content="${activeMeta.classification}" />`)
        .replace(/<meta name="twitter:url" content=".*?" \/>/, `<meta name="twitter:url" content="${activeMeta.url}" />`)
        .replace(/<meta name="twitter:title" content=".*?" \/>/, `<meta name="twitter:title" content="${activeMeta.title}" />`)
        .replace(/<meta name="twitter:description" content=".*?" \/>/, `<meta name="twitter:description" content="${activeMeta.description}" />`)
        .replace(/"name": "World Monitor"/, `"name": "${activeMeta.siteName}"`)
        .replace(/"alternateName": "WorldMonitor"/, `"alternateName": "${activeMeta.siteName.replace(' ', '')}"`)
        .replace(/"url": "https:\/\/worldmonitor\.app\/"/, `"url": "${activeMeta.url}"`)
        .replace(/"description": "Real-time global intelligence dashboard with live news, markets, military tracking, infrastructure monitoring, and geopolitical data."/, `"description": "${activeMeta.description}"`)
        .replace(/"featureList": \[[\s\S]*?\]/, `"featureList": ${JSON.stringify(activeMeta.features, null, 8).replace(/\n/g, '\n      ')}`);

      // Theme-color meta — warm cream for happy variant
      if (activeVariant === 'happy') {
        result = result.replace(
          /<meta name="theme-color" content=".*?" \/>/,
          '<meta name="theme-color" content="#FAFAF5" />'
        );
      }

      // Desktop builds: inject build-time variant into the inline script so data-variant is set
      // before CSS loads. Web builds always use 'full' — runtime hostname detection handles variants.
      if (activeVariant !== 'full') {
        result = result.replace(
          /if\(v\)document\.documentElement\.dataset\.variant=v;/,
          `v='${activeVariant}';document.documentElement.dataset.variant=v;`
        );
      }

      // Desktop CSP: inject localhost wildcard for dynamic sidecar port.
      // Web builds intentionally exclude localhost to avoid exposing attack surface.
      if (isDesktopBuild) {
        result = result
          .replace(
            /connect-src 'self' https: http:\/\/localhost:5173/,
            "connect-src 'self' https: http://localhost:5173 http://127.0.0.1:*"
          )
          .replace(
            /frame-src 'self'/,
            "frame-src 'self' http://127.0.0.1:*"
          );
      }

      // Desktop builds: replace favicon paths with variant-specific subdirectory.
      // Web builds use 'full' favicons in HTML; runtime JS swaps them per hostname.
      if (activeVariant !== 'full') {
        result = result
          .replace(/\/favico\/favicon/g, `/favico/${activeVariant}/favicon`)
          .replace(/\/favico\/apple-touch-icon/g, `/favico/${activeVariant}/apple-touch-icon`)
          .replace(/\/favico\/android-chrome/g, `/favico/${activeVariant}/android-chrome`)
          .replace(/\/favico\/og-image/g, `/favico/${activeVariant}/og-image`);
      }

      return result;
    },
  };
}

function polymarketPlugin(): Plugin {
  const GAMMA_BASE = 'https://gamma-api.polymarket.com';
  const ALLOWED_ORDER = ['volume', 'liquidity', 'startDate', 'endDate', 'spread'];

  return {
    name: 'polymarket-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/polymarket')) return next();

        const url = new URL(req.url, 'http://localhost');
        const endpoint = url.searchParams.get('endpoint') || 'markets';
        const closed = ['true', 'false'].includes(url.searchParams.get('closed') ?? '') ? url.searchParams.get('closed') : 'false';
        const order = ALLOWED_ORDER.includes(url.searchParams.get('order') ?? '') ? url.searchParams.get('order') : 'volume';
        const ascending = ['true', 'false'].includes(url.searchParams.get('ascending') ?? '') ? url.searchParams.get('ascending') : 'false';
        const rawLimit = parseInt(url.searchParams.get('limit') ?? '', 10);
        const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(100, rawLimit));

        const params = new URLSearchParams({ closed: closed!, order: order!, ascending: ascending!, limit: String(limit) });
        if (endpoint === 'events') {
          const tag = (url.searchParams.get('tag') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 100);
          if (tag) params.set('tag_slug', tag);
        }

        const gammaUrl = `${GAMMA_BASE}/${endpoint === 'events' ? 'events' : 'markets'}?${params}`;

        res.setHeader('Content-Type', 'application/json');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(gammaUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
          clearTimeout(timer);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.text();
          res.setHeader('Cache-Control', 'public, max-age=120');
          res.setHeader('X-Polymarket-Source', 'gamma');
          res.end(data);
        } catch {
          // Expected: Cloudflare JA3 blocks server-side TLS — return empty array
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end('[]');
        }
      });
    },
  };
}

/**
 * Vite dev server plugin for sebuf API routes.
 *
 * Intercepts requests matching /api/{domain}/v1/* and routes them through
 * the same handler pipeline as the Vercel catch-all gateway. Other /api/*
 * paths fall through to existing proxy rules.
 */
function sebufApiPlugin(): Plugin {
  // Cache router across requests (H-13 fix). Invalidated by Vite's module graph on HMR.
  let cachedRouter: Awaited<ReturnType<typeof buildRouter>> | null = null;
  let cachedCorsMod: any = null;

  async function buildRouter() {
    const [
      routerMod, corsMod, errorMod,
      seismologyServerMod, seismologyHandlerMod,
      wildfireServerMod, wildfireHandlerMod,
      climateServerMod, climateHandlerMod,
      predictionServerMod, predictionHandlerMod,
      displacementServerMod, displacementHandlerMod,
      aviationServerMod, aviationHandlerMod,
      researchServerMod, researchHandlerMod,
      unrestServerMod, unrestHandlerMod,
      conflictServerMod, conflictHandlerMod,
      maritimeServerMod, maritimeHandlerMod,
      cyberServerMod, cyberHandlerMod,
      economicServerMod, economicHandlerMod,
      infrastructureServerMod, infrastructureHandlerMod,
      marketServerMod, marketHandlerMod,
      newsServerMod, newsHandlerMod,
      intelligenceServerMod, intelligenceHandlerMod,
      militaryServerMod, militaryHandlerMod,
      positiveEventsServerMod, positiveEventsHandlerMod,
      givingServerMod, givingHandlerMod,
      tradeServerMod, tradeHandlerMod,
      supplyChainServerMod, supplyChainHandlerMod,
      naturalServerMod, naturalHandlerMod,
    ] = await Promise.all([
        import('./server/router'),
        import('./server/cors'),
        import('./server/error-mapper'),
        import('./src/generated/server/worldmonitor/seismology/v1/service_server'),
        import('./server/worldmonitor/seismology/v1/handler'),
        import('./src/generated/server/worldmonitor/wildfire/v1/service_server'),
        import('./server/worldmonitor/wildfire/v1/handler'),
        import('./src/generated/server/worldmonitor/climate/v1/service_server'),
        import('./server/worldmonitor/climate/v1/handler'),
        import('./src/generated/server/worldmonitor/prediction/v1/service_server'),
        import('./server/worldmonitor/prediction/v1/handler'),
        import('./src/generated/server/worldmonitor/displacement/v1/service_server'),
        import('./server/worldmonitor/displacement/v1/handler'),
        import('./src/generated/server/worldmonitor/aviation/v1/service_server'),
        import('./server/worldmonitor/aviation/v1/handler'),
        import('./src/generated/server/worldmonitor/research/v1/service_server'),
        import('./server/worldmonitor/research/v1/handler'),
        import('./src/generated/server/worldmonitor/unrest/v1/service_server'),
        import('./server/worldmonitor/unrest/v1/handler'),
        import('./src/generated/server/worldmonitor/conflict/v1/service_server'),
        import('./server/worldmonitor/conflict/v1/handler'),
        import('./src/generated/server/worldmonitor/maritime/v1/service_server'),
        import('./server/worldmonitor/maritime/v1/handler'),
        import('./src/generated/server/worldmonitor/cyber/v1/service_server'),
        import('./server/worldmonitor/cyber/v1/handler'),
        import('./src/generated/server/worldmonitor/economic/v1/service_server'),
        import('./server/worldmonitor/economic/v1/handler'),
        import('./src/generated/server/worldmonitor/infrastructure/v1/service_server'),
        import('./server/worldmonitor/infrastructure/v1/handler'),
        import('./src/generated/server/worldmonitor/market/v1/service_server'),
        import('./server/worldmonitor/market/v1/handler'),
        import('./src/generated/server/worldmonitor/news/v1/service_server'),
        import('./server/worldmonitor/news/v1/handler'),
        import('./src/generated/server/worldmonitor/intelligence/v1/service_server'),
        import('./server/worldmonitor/intelligence/v1/handler'),
        import('./src/generated/server/worldmonitor/military/v1/service_server'),
        import('./server/worldmonitor/military/v1/handler'),
        import('./src/generated/server/worldmonitor/positive_events/v1/service_server'),
        import('./server/worldmonitor/positive-events/v1/handler'),
        import('./src/generated/server/worldmonitor/giving/v1/service_server'),
        import('./server/worldmonitor/giving/v1/handler'),
        import('./src/generated/server/worldmonitor/trade/v1/service_server'),
        import('./server/worldmonitor/trade/v1/handler'),
        import('./src/generated/server/worldmonitor/supply_chain/v1/service_server'),
        import('./server/worldmonitor/supply-chain/v1/handler'),
        import('./src/generated/server/worldmonitor/natural/v1/service_server'),
        import('./server/worldmonitor/natural/v1/handler'),
      ]);

    const serverOptions = { onError: errorMod.mapErrorToResponse };
    const allRoutes = [
      ...seismologyServerMod.createSeismologyServiceRoutes(seismologyHandlerMod.seismologyHandler, serverOptions),
      ...wildfireServerMod.createWildfireServiceRoutes(wildfireHandlerMod.wildfireHandler, serverOptions),
      ...climateServerMod.createClimateServiceRoutes(climateHandlerMod.climateHandler, serverOptions),
      ...predictionServerMod.createPredictionServiceRoutes(predictionHandlerMod.predictionHandler, serverOptions),
      ...displacementServerMod.createDisplacementServiceRoutes(displacementHandlerMod.displacementHandler, serverOptions),
      ...aviationServerMod.createAviationServiceRoutes(aviationHandlerMod.aviationHandler, serverOptions),
      ...researchServerMod.createResearchServiceRoutes(researchHandlerMod.researchHandler, serverOptions),
      ...unrestServerMod.createUnrestServiceRoutes(unrestHandlerMod.unrestHandler, serverOptions),
      ...conflictServerMod.createConflictServiceRoutes(conflictHandlerMod.conflictHandler, serverOptions),
      ...maritimeServerMod.createMaritimeServiceRoutes(maritimeHandlerMod.maritimeHandler, serverOptions),
      ...cyberServerMod.createCyberServiceRoutes(cyberHandlerMod.cyberHandler, serverOptions),
      ...economicServerMod.createEconomicServiceRoutes(economicHandlerMod.economicHandler, serverOptions),
      ...infrastructureServerMod.createInfrastructureServiceRoutes(infrastructureHandlerMod.infrastructureHandler, serverOptions),
      ...marketServerMod.createMarketServiceRoutes(marketHandlerMod.marketHandler, serverOptions),
      ...newsServerMod.createNewsServiceRoutes(newsHandlerMod.newsHandler, serverOptions),
      ...intelligenceServerMod.createIntelligenceServiceRoutes(intelligenceHandlerMod.intelligenceHandler, serverOptions),
      ...militaryServerMod.createMilitaryServiceRoutes(militaryHandlerMod.militaryHandler, serverOptions),
      ...positiveEventsServerMod.createPositiveEventsServiceRoutes(positiveEventsHandlerMod.positiveEventsHandler, serverOptions),
      ...givingServerMod.createGivingServiceRoutes(givingHandlerMod.givingHandler, serverOptions),
      ...tradeServerMod.createTradeServiceRoutes(tradeHandlerMod.tradeHandler, serverOptions),
      ...supplyChainServerMod.createSupplyChainServiceRoutes(supplyChainHandlerMod.supplyChainHandler, serverOptions),
      ...naturalServerMod.createNaturalServiceRoutes(naturalHandlerMod.naturalHandler, serverOptions),
    ];
    cachedCorsMod = corsMod;
    return routerMod.createRouter(allRoutes);
  }

  return {
    name: 'sebuf-api',
    configureServer(server) {
      // Invalidate cached router on HMR updates to server/ files
      server.watcher.on('change', (file) => {
        if (file.includes('/server/') || file.includes('/src/generated/server/')) {
          cachedRouter = null;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        // Only intercept sebuf routes: /api/{domain}/v1/* (domain may contain hyphens)
        if (!req.url || !/^\/api\/[a-z-]+\/v1\//.test(req.url)) {
          return next();
        }

        try {
          // Build router once, reuse across requests (H-13 fix)
          if (!cachedRouter) {
            cachedRouter = await buildRouter();
          }
          const router = cachedRouter;
          const corsMod = cachedCorsMod;

          // Convert Connect IncomingMessage to Web Standard Request
          const port = server.config.server.port || 3000;
          const url = new URL(req.url, `http://localhost:${port}`);

          // Read body for POST requests
          let body: string | undefined;
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            body = Buffer.concat(chunks).toString();
          }

          // Extract headers from IncomingMessage
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(', ');
            }
          }

          const webRequest = new Request(url.toString(), {
            method: req.method,
            headers,
            body: body || undefined,
          });

          const corsHeaders = corsMod.getCorsHeaders(webRequest);

          // OPTIONS preflight
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end();
            return;
          }

          // Origin check
          if (corsMod.isDisallowedOrigin(webRequest)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end(JSON.stringify({ error: 'Origin not allowed' }));
            return;
          }

          // Route matching
          const matchedHandler = router.match(webRequest);
          if (!matchedHandler) {
            const allowed = router.allowedMethods(new URL(webRequest.url).pathname);
            if (allowed.length > 0) {
              res.statusCode = 405;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Allow', allowed.join(', '));
            } else {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
            }
            for (const [key, value] of Object.entries(corsHeaders)) {
              res.setHeader(key, value);
            }
            res.end(JSON.stringify({ error: res.statusCode === 405 ? 'Method not allowed' : 'Not found' }));
            return;
          }

          // Execute handler
          const response = await matchedHandler(webRequest);

          // Write response
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          for (const [key, value] of Object.entries(corsHeaders)) {
            res.setHeader(key, value);
          }
          res.end(await response.text());
        } catch (err) {
          console.error('[sebuf-api] Error:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    },
  };
}

// RSS proxy allowlist — duplicated from api/rss-proxy.js for dev mode.
// Keep in sync when adding new domains.
const RSS_PROXY_ALLOWED_DOMAINS = new Set([
  'feeds.bbci.co.uk', 'www.theguardian.com', 'feeds.npr.org', 'news.google.com',
  'www.aljazeera.com', 'rss.cnn.com', 'hnrss.org', 'feeds.arstechnica.com',
  'www.theverge.com', 'www.cnbc.com', 'feeds.marketwatch.com', 'www.defenseone.com',
  'breakingdefense.com', 'www.bellingcat.com', 'techcrunch.com', 'huggingface.co',
  'www.technologyreview.com', 'rss.arxiv.org', 'export.arxiv.org',
  'www.federalreserve.gov', 'www.sec.gov', 'www.whitehouse.gov', 'www.state.gov',
  'www.defense.gov', 'home.treasury.gov', 'www.justice.gov', 'tools.cdc.gov',
  'www.fema.gov', 'www.dhs.gov', 'www.thedrive.com', 'krebsonsecurity.com',
  'finance.yahoo.com', 'thediplomat.com', 'venturebeat.com', 'foreignpolicy.com',
  'www.ft.com', 'openai.com', 'www.reutersagency.com', 'feeds.reuters.com',
  'asia.nikkei.com', 'www.cfr.org', 'www.csis.org', 'www.politico.com',
  'www.brookings.edu', 'layoffs.fyi', 'www.defensenews.com', 'www.militarytimes.com',
  'taskandpurpose.com', 'news.usni.org', 'www.oryxspioenkop.com', 'www.gov.uk',
  'www.foreignaffairs.com', 'www.atlanticcouncil.org',
  // Tech variant
  'www.zdnet.com', 'www.techmeme.com', 'www.darkreading.com', 'www.schneier.com',
  'rss.politico.com', 'www.anandtech.com', 'www.tomshardware.com', 'www.semianalysis.com',
  'feed.infoq.com', 'thenewstack.io', 'devops.com', 'dev.to', 'lobste.rs', 'changelog.com',
  'seekingalpha.com', 'news.crunchbase.com', 'www.saastr.com', 'feeds.feedburner.com',
  'www.producthunt.com', 'www.axios.com', 'api.axios.com', 'github.blog', 'githubnext.com',
  'mshibanami.github.io', 'www.engadget.com', 'news.mit.edu', 'dev.events',
  'www.ycombinator.com', 'a16z.com', 'review.firstround.com', 'www.sequoiacap.com',
  'www.nfx.com', 'www.aaronsw.com', 'bothsidesofthetable.com', 'www.lennysnewsletter.com',
  'stratechery.com', 'www.eu-startups.com', 'tech.eu', 'sifted.eu', 'www.techinasia.com',
  'kr-asia.com', 'techcabal.com', 'disrupt-africa.com', 'lavca.org', 'contxto.com',
  'inc42.com', 'yourstory.com', 'pitchbook.com', 'www.cbinsights.com', 'www.techstars.com',
  // Regional & international
  'english.alarabiya.net', 'www.arabnews.com', 'www.timesofisrael.com', 'www.haaretz.com',
  'www.scmp.com', 'kyivindependent.com', 'www.themoscowtimes.com', 'feeds.24.com',
  'feeds.capi24.com', 'www.france24.com', 'www.euronews.com', 'www.lemonde.fr',
  'rss.dw.com', 'www.africanews.com', 'www.lasillavacia.com', 'www.channelnewsasia.com',
  'www.thehindu.com', 'news.un.org', 'www.iaea.org', 'www.who.int', 'www.cisa.gov',
  'www.crisisgroup.org',
  // Think tanks
  'rusi.org', 'warontherocks.com', 'www.aei.org', 'responsiblestatecraft.org',
  'www.fpri.org', 'jamestown.org', 'www.chathamhouse.org', 'ecfr.eu', 'www.gmfus.org',
  'www.wilsoncenter.org', 'www.lowyinstitute.org', 'www.mei.edu', 'www.stimson.org',
  'www.cnas.org', 'carnegieendowment.org', 'www.rand.org', 'fas.org',
  'www.armscontrol.org', 'www.nti.org', 'thebulletin.org', 'www.iss.europa.eu',
  // Economic & Food Security
  'www.fao.org', 'worldbank.org', 'www.imf.org',
  // Regional locale feeds
  'www.hurriyet.com.tr', 'tvn24.pl', 'www.polsatnews.pl', 'www.rp.pl', 'meduza.io',
  'novayagazeta.eu', 'www.bangkokpost.com', 'vnexpress.net', 'www.abc.net.au',
  'news.ycombinator.com',
  // Finance variant
  'www.coindesk.com', 'cointelegraph.com',
  // Happy variant — positive news sources
  'www.goodnewsnetwork.org', 'www.positive.news', 'reasonstobecheerful.world',
  'www.optimistdaily.com', 'www.sunnyskyz.com', 'www.huffpost.com',
  'www.sciencedaily.com', 'feeds.nature.com', 'www.livescience.com', 'www.newscientist.com',
]);

/**
 * Dev-only plugin: serves /api/afp-direct by fetching AFP articles server-side.
 * Uses AFP credentials from .env.local (not exposed to browser).
 */
/** Extract text content of the first matching XML tag (strips nested tags). */
function _extractXmlText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract full body paragraphs from AFP NewsML XML.
 * AFP uses <body.content> inside <nitf> or <inlineXML> with <p> tags.
 */
function _extractAfpBodyParagraphs(xml: string): string {
  // Try to find body.content section
  const bodySection = xml.match(/<body\.content[^>]*>([\s\S]*?)<\/body\.content>/i)?.[1]
    ?? xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? '';

  if (!bodySection) return '';

  const paragraphs: string[] = [];
  const pRegex = /<p(?:\s[^>]*)?>([^]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(bodySection)) !== null) {
    const text = m[1]!
      .replace(/<[^>]+>/g, ' ')       // strip inline tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) paragraphs.push(text);
  }

  return paragraphs.join('\n\n');
}

function afpDevPlugin(): Plugin {
  const AFP_API = 'https://afp-apicore-prod.afp.com';
  let cachedToken: { accessToken: string; expiresAt: number } | null = null;
  let cachedResult: { data: string; timestamp: number } | null = null;
  const CACHE_TTL = 10 * 60_000; // 10min cache
  const articleCache = new Map<string, { body: string; title: string; timestamp: number }>();
  const ARTICLE_CACHE_TTL = 60 * 60_000; // 1h for individual articles

  async function ensureToken(clientId: string, clientSecret: string, username: string, password: string): Promise<string | null> {
    if (!cachedToken || Date.now() >= cachedToken.expiresAt) {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResp = await fetch(`${AFP_API}/oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'password', username, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResp.ok) return null;
      const tokenData = await tokenResp.json() as { access_token: string; expires_in?: number };
      cachedToken = { accessToken: tokenData.access_token, expiresAt: Date.now() + ((tokenData.expires_in || 3600) * 1000) - 60_000 };
    }
    return cachedToken.accessToken;
  }

  return {
    name: 'afp-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        // ── /api/afp-article?uno={id}  ──────────────────────────────────────
        if (url.startsWith('/api/afp-article')) {
          const uno = new URL(url, 'http://localhost').searchParams.get('uno') || '';
          if (!uno) { res.statusCode = 400; res.end('Missing uno'); return; }

          // Serve from cache
          const cached = articleCache.get(uno);
          if (cached && Date.now() - cached.timestamp < ARTICLE_CACHE_TTL) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ body: cached.body, title: cached.title }));
            return;
          }

          const clientId = (process.env.AFP_CLIENT_ID || '').trim();
          const clientSecret = (process.env.AFP_CLIENT_SECRET || '').trim();
          const username = (process.env.AFP_USERNAME || '').trim();
          const password = (process.env.AFP_PASSWORD || '').trim();
          if (!clientId || !clientSecret || !username || !password) {
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ body: '', title: '' })); return;
          }

          try {
            const token = await ensureToken(clientId, clientSecret, username, password);
            if (!token) { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ body: '', title: '' })); return; }

            // Fetch full article via search with uno filter — `news` array contains all paragraphs
            const searchBody = { query: { and: [{ name: 'uno', in: [uno] }] }, maxRows: '1' };
            const searchResp = await fetch(`${AFP_API}/v1/api/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(searchBody),
              signal: AbortSignal.timeout(15_000),
            });

            let bodyText = '';
            let titleText = '';

            if (searchResp.ok) {
              const data = await searchResp.json() as { response?: { docs?: Array<Record<string, unknown>> } };
              const doc = data.response?.docs?.[0] || {};
              titleText = String(doc.title || doc.headline || '');
              // `news` array contains all article paragraphs — the full body
              bodyText = Array.isArray(doc.news)
                ? (doc.news as string[]).join('\n\n')
                : String(doc.body || doc.content || doc.abstract || '');
            }

            articleCache.set(uno, { body: bodyText, title: titleText, timestamp: Date.now() });
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ body: bodyText, title: titleText }));
          } catch (err: unknown) {
            console.error('[afp-article]', err instanceof Error ? err.message : err);
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ body: '', title: '' }));
          }
          return;
        }

        if (url !== '/api/afp-direct') return next();

        // Return cached if fresh
        if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(cachedResult.data);
          return;
        }

        const clientId = (process.env.AFP_CLIENT_ID || '').trim();
        const clientSecret = (process.env.AFP_CLIENT_SECRET || '').trim();
        const username = (process.env.AFP_USERNAME || '').trim();
        const password = (process.env.AFP_PASSWORD || '').trim();

        if (!clientId || !clientSecret || !username || !password) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ queries: [], alerts: [], summary: { totalQueries: 0, totalArticles: 0 }, fetchedAt: new Date().toISOString() }));
          return;
        }

        try {
          const token = await ensureToken(clientId, clientSecret, username, password);
          if (!token) throw new Error('AFP auth failed');
          const queries = [
            { id: 'afp-sentiment-all', category: 'sentiment', priority: 'medium', label: 'All Renault coverage',
              query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }] },
              dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
            { id: 'afp-finance-results', category: 'financial', priority: 'critical', label: 'Financial results & market', lang: 'fr',
              query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['résultats', 'bénéfice', 'perte', 'Bourse', 'cours', 'action'] }] },
              dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
            { id: 'afp-geo-industry', category: 'geopolitical', priority: 'high', label: 'Auto industry & competition', lang: 'fr',
              query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'keyword', in: ['automobile', 'industrie'] }] },
              dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
            { id: 'afp-legal-proceedings', category: 'legal', priority: 'medium', label: 'Court proceedings & lawsuits', lang: 'fr',
              query: { and: [{ name: 'class', and: ['text'] }, { name: 'entity_company', and: ['Renault'] }, { name: 'news', in: ['procès', 'tribunal', 'enquête', 'amende', 'justice'] }] },
              dateRange: { from: 'now-7d', to: 'now' }, maxRows: 50 },
          ];

          const results = [];
          for (const q of queries) {
            try {
              const body: Record<string, unknown> = { dateRange: q.dateRange, sortOrder: 'desc', sortField: 'published', maxRows: String(q.maxRows), query: q.query };
              if (q.lang) body.lang = q.lang;
              const searchResp = await fetch(`${AFP_API}/v1/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(20_000),
              });
              const data = await searchResp.json() as { response?: { docs?: Array<Record<string, unknown>> } };
              const docs = data.response?.docs || [];
              const articles = docs.map((doc: Record<string, unknown>) => {
                const title = String(doc.title || doc.headline || '');
                if (!title) return null;
                const rawUrg = String(doc.urgency || '4');
                return {
                  title, url: doc.href || '', source: 'AFP',
                  date: String(doc.published || doc.created || ''),
                  image: '', language: String(doc.lang || doc.language || ''),
                  tone: 0, urgency: parseInt(rawUrg, 10) || 4,
                  iptcCodes: [] as string[], slug: String(doc.slug || ''),
                  afpId: String(doc.uno || doc.guid || ''),
                  country: String(doc.country || ''), product: String(doc.product || 'text'),
                  abstract: String(doc.abstract || ''),
                  // AFP stores full article paragraphs in the `news` array field
                  body: Array.isArray(doc.news) ? (doc.news as string[]).join('\n\n') : String((doc as Record<string, unknown>).body || (doc as Record<string, unknown>).content || ''),
                };
              }).filter(Boolean);
              results.push({ id: q.id, category: q.category, priority: q.priority, label: q.label, lang: q.lang || '', articles, articleCount: articles.length, fetchedAt: new Date().toISOString() });
            } catch { results.push({ id: q.id, category: q.category, priority: q.priority, label: q.label, lang: q.lang || '', articles: [], articleCount: 0, fetchedAt: new Date().toISOString(), error: 'fetch failed' }); }
            await new Promise(r => setTimeout(r, 1500)); // rate limit
          }

          const payload = JSON.stringify({ queries: results, alerts: [], summary: { totalQueries: results.length, totalArticles: results.reduce((s, r) => s + r.articleCount, 0) }, fetchedAt: new Date().toISOString() });
          cachedResult = { data: payload, timestamp: Date.now() };
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(payload);
        } catch (err: unknown) {
          console.error('[afp-dev]', err instanceof Error ? err.message : err);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ queries: [], alerts: [], summary: { totalQueries: 0, totalArticles: 0 }, fetchedAt: new Date().toISOString() }));
        }
      });
    },
  };
}

function rssProxyPlugin(): Plugin {
  return {
    name: 'rss-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/rss-proxy')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const feedUrl = url.searchParams.get('url');
        if (!feedUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        try {
          const parsed = new URL(feedUrl);
          if (!RSS_PROXY_ALLOWED_DOMAINS.has(parsed.hostname)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Domain not allowed: ${parsed.hostname}` }));
            return;
          }

          const controller = new AbortController();
          const timeout = feedUrl.includes('news.google.com') ? 20000 : 12000;
          const timer = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(feedUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
            redirect: 'follow',
          });
          clearTimeout(timer);

          const data = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/xml');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(data);
        } catch (error: any) {
          console.error('[rss-proxy]', feedUrl, error.message);
          res.statusCode = error.name === 'AbortError' ? 504 : 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.name === 'AbortError' ? 'Feed timeout' : 'Failed to fetch feed' }));
        }
      });
    },
  };
}

function youtubeLivePlugin(): Plugin {
  return {
    name: 'youtube-live',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/youtube/live')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const channel = url.searchParams.get('channel');

        if (!channel) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing channel parameter' }));
          return;
        }

        try {
          const channelHandle = channel.startsWith('@') ? channel : `@${channel}`;
          const liveUrl = `https://www.youtube.com/${channelHandle}/live`;

          const ytRes = await fetch(liveUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
          });

          if (!ytRes.ok) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.end(JSON.stringify({ videoId: null, channel }));
            return;
          }

          const html = await ytRes.text();

          // Scope both fields to the same videoDetails block so we don't
          // combine a videoId from one object with isLive from another.
          let videoId: string | null = null;
          const detailsIdx = html.indexOf('"videoDetails"');
          if (detailsIdx !== -1) {
            const block = html.substring(detailsIdx, detailsIdx + 5000);
            const vidMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            const liveMatch = block.match(/"isLive"\s*:\s*true/);
            if (vidMatch && liveMatch) {
              videoId = vidMatch[1];
            }
          }

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify({ videoId, isLive: videoId !== null, channel }));
        } catch (error) {
          console.error(`[YouTube Live] Error:`, error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Failed to fetch', videoId: null }));
        }
      });
    },
  };
}

function gpsjamDevPlugin(): Plugin {
  return {
    name: 'gpsjam-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/gpsjam' && !req.url?.startsWith('/api/gpsjam?')) {
          return next();
        }

        try {
          const data = await readFile(resolve(__dirname, 'scripts/data/gpsjam-latest.json'), 'utf8');
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(data);
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify({ error: 'No GPS jam data. Run: node scripts/fetch-gpsjam.mjs' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Inject environment variables from .env files into process.env.
  // This ensures that API keys and other secrets in .env.local are
  // available to the dev server plugins and server-side handlers.
  Object.assign(process.env, env);

  const isE2E = process.env.VITE_E2E === '1';
  const isDesktopBuild = process.env.VITE_DESKTOP_RUNTIME === '1';
  const activeVariant = process.env.VITE_VARIANT || 'full';
  const activeMeta = VARIANT_META[activeVariant] || VARIANT_META.full;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      htmlVariantPlugin(activeMeta, activeVariant, isDesktopBuild),
      polymarketPlugin(),
      afpDevPlugin(),
      rssProxyPlugin(),
      youtubeLivePlugin(),
      gpsjamDevPlugin(),
      sebufApiPlugin(),
      brotliPrecompressPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,

        includeAssets: [
          'favico/favicon.ico',
          'favico/apple-touch-icon.png',
          'favico/favicon-32x32.png',
        ],

        manifest: {
          name: `${activeMeta.siteName} - ${activeMeta.subject}`,
          short_name: activeMeta.shortName,
          description: activeMeta.description,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#0a0f0a',
          background_color: '#0a0f0a',
          categories: activeMeta.categories,
          icons: [
            { src: '/favico/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/favico/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/favico/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },

        workbox: {
          globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
          globIgnores: ['**/ml*.js', '**/onnx*.wasm', '**/locale-*.js'],
          // globe.gl + three.js grows main bundle past the 2 MiB default limit
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: null,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,

          runtimeCaching: [
            {
              urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-navigation',
                networkTimeoutSeconds: 5,
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && /^\/api\//.test(url.pathname),
              handler: 'NetworkOnly',
              method: 'GET',
            },
            {
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && /^\/api\//.test(url.pathname),
              handler: 'NetworkOnly',
              method: 'POST',
            },
            {
              urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                sameOrigin && /^\/rss\//.test(url.pathname),
              handler: 'NetworkOnly',
              method: 'GET',
            },
            {
              urlPattern: ({ url }: { url: URL }) =>
                url.pathname.endsWith('.pmtiles') ||
                url.hostname.endsWith('.r2.dev') ||
                url.hostname === 'build.protomaps.com',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pmtiles-ranges',
                expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/protomaps\.github\.io\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'protomaps-assets',
                expiration: { maxEntries: 100, maxAgeSeconds: 365 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-css',
                expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-woff',
                expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /\/assets\/locale-.*\.js$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'locale-files',
                expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
              },
            },
          ],
        },

        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        child_process: resolve(__dirname, 'src/shims/child-process.ts'),
        'node:child_process': resolve(__dirname, 'src/shims/child-process.ts'),
        '@loaders.gl/worker-utils/dist/lib/process-utils/child-process-proxy.js': resolve(
          __dirname,
          'src/shims/child-process-proxy.ts'
        ),
      },
    },
    worker: {
      format: 'es',
    },
    build: {
      // Geospatial bundles (maplibre/deck) are expected to be large even when split.
      // Raise warning threshold to reduce noisy false alarms in CI.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        onwarn(warning, warn) {
          // onnxruntime-web ships a minified browser bundle that intentionally uses eval.
          // Keep build logs focused by filtering this known third-party warning only.
          if (
            warning.code === 'EVAL'
            && typeof warning.id === 'string'
            && warning.id.includes('/onnxruntime-web/dist/ort-web.min.js')
          ) {
            return;
          }

          warn(warning);
        },
        input: {
          main: resolve(__dirname, 'index.html'),
          settings: resolve(__dirname, 'settings.html'),
          liveChannels: resolve(__dirname, 'live-channels.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('/@xenova/transformers/')) {
                return 'transformers';
              }
              if (id.includes('/onnxruntime-web/')) {
                return 'onnxruntime';
              }
              if (id.includes('/maplibre-gl/') || id.includes('/pmtiles/') || id.includes('/@protomaps/basemaps/')) {
                return 'maplibre';
              }
              if (
                id.includes('/@deck.gl/')
                || id.includes('/@luma.gl/')
                || id.includes('/@loaders.gl/')
                || id.includes('/@math.gl/')
                || id.includes('/h3-js/')
              ) {
                return 'deck-stack';
              }
              if (id.includes('/d3/')) {
                return 'd3';
              }
              if (id.includes('/topojson-client/')) {
                return 'topojson';
              }
              if (id.includes('/i18next')) {
                return 'i18n';
              }
              if (id.includes('/@sentry/')) {
                return 'sentry';
              }
            }
            if (id.includes('/src/components/') && id.endsWith('Panel.ts')) {
              return 'panels';
            }
            // Give lazy-loaded locale chunks a recognizable prefix so the
            // service worker can exclude them from precache (en.json is
            // statically imported into the main bundle).
            const localeMatch = id.match(/\/locales\/(\w+)\.json$/);
            if (localeMatch && localeMatch[1] !== 'en') {
              return `locale-${localeMatch[1]}`;
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: 3000,
      open: !isE2E,
      hmr: isE2E ? false : undefined,
      watch: {
        ignored: [
          '**/test-results/**',
          '**/playwright-report/**',
          '**/.playwright-mcp/**',
        ],
      },
      proxy: {
        // Widget agent — forward to Railway relay for SSE streaming
        '/widget-agent': {
          target: 'https://proxy.worldmonitor.app',
          changeOrigin: true,
        },
        // Yahoo Finance API
        '/api/yahoo': {
          target: 'https://query1.finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        },
        // Polymarket handled by polymarketPlugin() — no prod proxy needed
        // USGS Earthquake API
        '/api/earthquake': {
          target: 'https://earthquake.usgs.gov',
          changeOrigin: true,
          timeout: 30000,
          rewrite: (path) => path.replace(/^\/api\/earthquake/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('Earthquake proxy error:', err.message);
            });
          },
        },
        // PizzINT - Pentagon Pizza Index
        '/api/pizzint': {
          target: 'https://www.pizzint.watch',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/pizzint/, '/api'),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('PizzINT proxy error:', err.message);
            });
          },
        },
        // FRED Economic Data - handled by Vercel serverless function in prod
        // In dev, we proxy to the API directly with the key from .env
        '/api/fred-data': {
          target: 'https://api.stlouisfed.org',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL(path, 'http://localhost');
            const seriesId = url.searchParams.get('series_id');
            const start = url.searchParams.get('observation_start');
            const end = url.searchParams.get('observation_end');
            const apiKey = process.env.FRED_API_KEY || '';
            return `/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10${start ? `&observation_start=${start}` : ''}${end ? `&observation_end=${end}` : ''}`;
          },
        },
        // RSS Feeds - BBC
        '/rss/bbc': {
          target: 'https://feeds.bbci.co.uk',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/bbc/, ''),
        },
        // RSS Feeds - Guardian
        '/rss/guardian': {
          target: 'https://www.theguardian.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/guardian/, ''),
        },
        // RSS Feeds - NPR
        '/rss/npr': {
          target: 'https://feeds.npr.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/npr/, ''),
        },
        // RSS Feeds - Al Jazeera
        '/rss/aljazeera': {
          target: 'https://www.aljazeera.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/aljazeera/, ''),
        },
        // RSS Feeds - CNN
        '/rss/cnn': {
          target: 'http://rss.cnn.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/cnn/, ''),
        },
        // RSS Feeds - Hacker News
        '/rss/hn': {
          target: 'https://hnrss.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/hn/, ''),
        },
        // RSS Feeds - Ars Technica
        '/rss/arstechnica': {
          target: 'https://feeds.arstechnica.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/arstechnica/, ''),
        },
        // RSS Feeds - The Verge
        '/rss/verge': {
          target: 'https://www.theverge.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/verge/, ''),
        },
        // RSS Feeds - CNBC
        '/rss/cnbc': {
          target: 'https://www.cnbc.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/cnbc/, ''),
        },
        // RSS Feeds - MarketWatch
        '/rss/marketwatch': {
          target: 'https://feeds.marketwatch.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/marketwatch/, ''),
        },
        // RSS Feeds - Defense/Intel sources
        '/rss/defenseone': {
          target: 'https://www.defenseone.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/defenseone/, ''),
        },
        '/rss/warontherocks': {
          target: 'https://warontherocks.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/warontherocks/, ''),
        },
        '/rss/breakingdefense': {
          target: 'https://breakingdefense.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/breakingdefense/, ''),
        },
        '/rss/bellingcat': {
          target: 'https://www.bellingcat.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/bellingcat/, ''),
        },
        // RSS Feeds - TechCrunch (layoffs)
        '/rss/techcrunch': {
          target: 'https://techcrunch.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/techcrunch/, ''),
        },
        // Google News RSS
        '/rss/googlenews': {
          target: 'https://news.google.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/googlenews/, ''),
        },
        // AI Company Blogs
        '/rss/openai': {
          target: 'https://openai.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/openai/, ''),
        },
        '/rss/anthropic': {
          target: 'https://www.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/anthropic/, ''),
        },
        '/rss/googleai': {
          target: 'https://blog.google',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/googleai/, ''),
        },
        '/rss/deepmind': {
          target: 'https://deepmind.google',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/deepmind/, ''),
        },
        '/rss/huggingface': {
          target: 'https://huggingface.co',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/huggingface/, ''),
        },
        '/rss/techreview': {
          target: 'https://www.technologyreview.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/techreview/, ''),
        },
        '/rss/arxiv': {
          target: 'https://rss.arxiv.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/arxiv/, ''),
        },
        // Government
        '/rss/whitehouse': {
          target: 'https://www.whitehouse.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/whitehouse/, ''),
        },
        '/rss/statedept': {
          target: 'https://www.state.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/statedept/, ''),
        },
        '/rss/state': {
          target: 'https://www.state.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/state/, ''),
        },
        '/rss/defense': {
          target: 'https://www.defense.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/defense/, ''),
        },
        '/rss/justice': {
          target: 'https://www.justice.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/justice/, ''),
        },
        '/rss/cdc': {
          target: 'https://tools.cdc.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/cdc/, ''),
        },
        '/rss/fema': {
          target: 'https://www.fema.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/fema/, ''),
        },
        '/rss/dhs': {
          target: 'https://www.dhs.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/dhs/, ''),
        },
        '/rss/fedreserve': {
          target: 'https://www.federalreserve.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/fedreserve/, ''),
        },
        '/rss/sec': {
          target: 'https://www.sec.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/sec/, ''),
        },
        '/rss/treasury': {
          target: 'https://home.treasury.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/treasury/, ''),
        },
        '/rss/cisa': {
          target: 'https://www.cisa.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/cisa/, ''),
        },
        // Think Tanks
        '/rss/brookings': {
          target: 'https://www.brookings.edu',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/brookings/, ''),
        },
        '/rss/cfr': {
          target: 'https://www.cfr.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/cfr/, ''),
        },
        '/rss/csis': {
          target: 'https://www.csis.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/csis/, ''),
        },
        // Defense
        '/rss/warzone': {
          target: 'https://www.thedrive.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/warzone/, ''),
        },
        '/rss/defensegov': {
          target: 'https://www.defense.gov',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/defensegov/, ''),
        },
        // Security
        '/rss/krebs': {
          target: 'https://krebsonsecurity.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/krebs/, ''),
        },
        // Finance
        '/rss/yahoonews': {
          target: 'https://finance.yahoo.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/yahoonews/, ''),
        },
        // Diplomat
        '/rss/diplomat': {
          target: 'https://thediplomat.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/diplomat/, ''),
        },
        // VentureBeat
        '/rss/venturebeat': {
          target: 'https://venturebeat.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/venturebeat/, ''),
        },
        // Foreign Policy
        '/rss/foreignpolicy': {
          target: 'https://foreignpolicy.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/foreignpolicy/, ''),
        },
        // Financial Times
        '/rss/ft': {
          target: 'https://www.ft.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/ft/, ''),
        },
        // Reuters
        '/rss/reuters': {
          target: 'https://www.reutersagency.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rss\/reuters/, ''),
        },
        // Cloudflare Radar - Internet outages
        '/api/cloudflare-radar': {
          target: 'https://api.cloudflare.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/cloudflare-radar/, ''),
        },
        // NGA Maritime Safety Information - Navigation Warnings
        '/api/nga-msi': {
          target: 'https://msi.nga.mil',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/nga-msi/, ''),
        },
        // GDELT GEO 2.0 API - Global event data
        '/api/gdelt': {
          target: 'https://api.gdeltproject.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gdelt/, ''),
        },
        // AISStream WebSocket proxy for live vessel tracking
        '/ws/aisstream': {
          target: 'wss://stream.aisstream.io',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/ws\/aisstream/, ''),
        },
        // FAA NASSTATUS - Airport delays and closures
        '/api/faa': {
          target: 'https://nasstatus.faa.gov',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/faa/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('FAA NASSTATUS proxy error:', err.message);
            });
          },
        },
        // OpenSky Network - Aircraft tracking (military flight detection)
        '/api/opensky': {
          target: 'https://opensky-network.org/api',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/opensky/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('OpenSky proxy error:', err.message);
            });
          },
        },
        // ADS-B Exchange - Military aircraft tracking (backup/supplement)
        '/api/adsb-exchange': {
          target: 'https://adsbexchange.com/api',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/adsb-exchange/, ''),
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('ADS-B Exchange proxy error:', err.message);
            });
          },
        },
      },
    },
  };
});
