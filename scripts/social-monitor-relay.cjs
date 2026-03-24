const crypto = require('crypto');
const { WebSocket } = require('ws');

const USER_AGENT = 'WorldMonitor Renault Social Relay/1.0';
const SOCIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BUFFER_LIMIT = 2000;
const DEFAULT_SNAPSHOT_LIMIT = 600;
const DEFAULT_TERMS = [
  'renault',
  'groupe renault',
  'renault group',
  'dacia',
  'mobilize',
  'ampere',
  'horse',
  'luca de meo',
];
const DEFAULT_MASTODON_INSTANCES = ['mastodon.social', 'mstdn.social', 'piaille.fr', 'mamot.fr'];
const DEFAULT_MASTODON_TAGS = ['renault', 'dacia', 'mobilize', 'ampere'];
const DEFAULT_REDDIT_SUBREDDITS = ['cars', 'electricvehicles', 'formula1', 'france', 'europe', 'worldnews'];
const DEFAULT_REDDIT_TERMS = ['renault', 'dacia', 'mobilize'];
const DEFAULT_YOUTUBE_TERMS = ['renault', 'dacia'];
const DEFAULT_BLUESKY_JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
const DEFAULT_BLUESKY_API_BASE = 'https://api.bsky.app/xrpc';
const BLUESKY_BACKFILL_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.SOCIAL_BLUESKY_BACKFILL_MS || 15 * 60 * 1000));
const MASTODON_POLL_MS = Math.max(60 * 1000, Number(process.env.SOCIAL_MASTODON_POLL_MS || 90 * 1000));
const REDDIT_POLL_MS = Math.max(60 * 1000, Number(process.env.SOCIAL_REDDIT_POLL_MS || 120 * 1000));
const YOUTUBE_POLL_MS = Math.max(60 * 1000, Number(process.env.SOCIAL_YOUTUBE_POLL_MS || 120 * 1000));
const X_POLL_MS = Math.max(60 * 1000, Number(process.env.SOCIAL_X_POLL_MS || 60 * 1000));

function parseCsvEnv(raw, fallback) {
  if (!raw || typeof raw !== 'string') return [...fallback];
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : [...fallback];
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortDid(did) {
  if (!did) return '';
  return did.length > 18 ? `${did.slice(0, 12)}...${did.slice(-4)}` : did;
}

function toLowerText(parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hashKey(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function buildIngestRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundarySafe = /^[\p{L}\p{N}-]+$/u.test(term);
  return new RegExp(boundarySafe ? `\\b${escaped}\\b` : escaped, 'iu');
}

function matchesAnyTerm(text, terms) {
  if (!text) return false;
  return terms.some((term) => buildIngestRegex(term).test(text));
}

function extractHashtags(value) {
  const matches = String(value || '').match(/#([\p{L}\p{N}_-]+)/gu);
  return matches ? [...new Set(matches.map((match) => match.replace(/^#/, '').toLowerCase()))] : [];
}

function parseDateString(value, fallback = Date.now()) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : fallback;
}

function isoFromAny(value, fallback = Date.now()) {
  return new Date(parseDateString(value, fallback)).toISOString();
}

function connectorStatus(platform, enabled, state, detail) {
  return {
    platform,
    enabled,
    state,
    detail: detail || '',
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastItemAt: null,
    fetchedCount: 0,
  };
}

function normalizeSocialSearchText(post) {
  return normalizeWhitespace([
    post.text,
    post.authorName,
    post.authorHandle,
    post.channelTitle,
    post.profileLocation,
    post.subreddit,
    post.instance,
    Array.isArray(post.hashtags) ? post.hashtags.map((tag) => `#${tag}`).join(' ') : '',
  ].join(' '));
}

function buildDedupKey(post) {
  return `${post.platform}:${post.url || post.nativeId || post.id || hashKey(normalizeSocialSearchText(post))}`;
}

function dedupeNormalizedPosts(posts) {
  const seen = new Set();
  const deduped = [];
  for (const post of posts) {
    const key = buildDedupKey(post);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(post);
  }
  return deduped;
}

function createBasePost(platform, raw) {
  const url = String(raw.url || '').trim();
  const nativeId = String(raw.nativeId || '').trim();
  const authorName = normalizeWhitespace(raw.authorName || raw.channelTitle || 'Unknown author');
  const authorHandle = normalizeWhitespace(raw.authorHandle || '');
  const text = normalizeWhitespace(raw.text || raw.title || raw.description || '');
  const hashtags = Array.isArray(raw.hashtags) ? raw.hashtags.filter(Boolean).map((tag) => String(tag).toLowerCase()) : extractHashtags(text);
  const post = {
    id: `${platform}:${nativeId || hashKey(url || `${authorName}:${text}:${raw.publishedAt || Date.now()}`)}`,
    platform,
    nativeId: nativeId || undefined,
    url,
    text,
    authorName,
    authorHandle: authorHandle || undefined,
    channelTitle: normalizeWhitespace(raw.channelTitle || '') || undefined,
    hashtags,
    publishedAt: isoFromAny(raw.publishedAt || raw.createdAt || Date.now()),
    fetchedAt: isoFromAny(raw.fetchedAt || Date.now()),
    profileLocation: normalizeWhitespace(raw.profileLocation || '') || undefined,
    subreddit: normalizeWhitespace(raw.subreddit || '') || undefined,
    instance: normalizeWhitespace(raw.instance || '') || undefined,
    language: normalizeWhitespace(raw.language || '') || undefined,
    engagement: raw.engagement && typeof raw.engagement === 'object' ? raw.engagement : undefined,
  };
  post.searchText = normalizeSocialSearchText(post);
  return post;
}

function normalizeBlueskySearchPost(post) {
  if (!post || !post.author || !post.record) return null;
  const did = String(post.author.did || '').trim();
  const rkey = String((post.uri || '').split('/').pop() || '');
  return createBasePost('bluesky', {
    nativeId: rkey || post.uri || post.cid,
    url: did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : '',
    text: post.record.text || '',
    authorName: post.author.displayName || post.author.handle || shortDid(did),
    authorHandle: post.author.handle || shortDid(did),
    publishedAt: post.record.createdAt || post.indexedAt,
    hashtags: extractHashtags(post.record.text || ''),
    engagement: {
      likes: Number(post.likeCount || 0) || undefined,
      replies: Number(post.replyCount || 0) || undefined,
      reposts: Number(post.repostCount || 0) || undefined,
    },
  });
}

function normalizeBlueskyJetstreamCommit(message, profile) {
  const commit = message && message.commit;
  if (!commit || commit.collection !== 'app.bsky.feed.post' || commit.operation !== 'create') return null;
  const record = commit.record || {};
  const did = String(message.did || '').trim();
  const rkey = String(commit.rkey || '');
  return createBasePost('bluesky', {
    nativeId: rkey,
    url: did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : '',
    text: record.text || '',
    authorName: profile?.displayName || profile?.handle || shortDid(did),
    authorHandle: profile?.handle || shortDid(did),
    publishedAt: record.createdAt || (message.time_us ? new Date(Number(message.time_us) / 1000).toISOString() : Date.now()),
    hashtags: extractHashtags(record.text || ''),
  });
}

function normalizeMastodonStatus(status, instance) {
  if (!status || !status.account) return null;
  const authorHandle = String(status.account.acct || status.account.username || '').trim();
  return createBasePost('mastodon', {
    nativeId: status.id,
    url: status.url || status.uri || '',
    text: stripHtml(status.content || ''),
    authorName: status.account.display_name || authorHandle || 'Mastodon account',
    authorHandle: authorHandle ? `@${authorHandle}` : '',
    publishedAt: status.created_at,
    hashtags: Array.isArray(status.tags) ? status.tags.map((tag) => String(tag.name || '').toLowerCase()).filter(Boolean) : [],
    profileLocation: status.account.location || '',
    instance,
    language: status.language || '',
    engagement: {
      likes: Number(status.favourites_count || 0) || undefined,
      replies: Number(status.replies_count || 0) || undefined,
      reposts: Number(status.reblogs_count || 0) || undefined,
    },
  });
}

function normalizeYouTubeItem(item) {
  const snippet = item && item.snippet;
  const videoId = item && item.id && item.id.videoId;
  if (!snippet || !videoId) return null;
  return createBasePost('youtube', {
    nativeId: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    text: [snippet.title, snippet.description].filter(Boolean).join(' '),
    authorName: snippet.channelTitle || 'YouTube channel',
    channelTitle: snippet.channelTitle || '',
    publishedAt: snippet.publishedAt,
  });
}

function normalizeRedditPost(post, subreddit) {
  if (!post) return null;
  const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
  return createBasePost('reddit', {
    nativeId: post.id,
    url: permalink,
    text: [post.title, post.selftext].filter(Boolean).join(' '),
    authorName: post.author || 'reddit',
    authorHandle: post.author ? `u/${post.author}` : '',
    publishedAt: post.created_utc ? new Date(Number(post.created_utc) * 1000).toISOString() : Date.now(),
    subreddit: subreddit || post.subreddit || '',
    engagement: {
      comments: Number(post.num_comments || 0) || undefined,
      score: Number(post.score || 0) || undefined,
    },
  });
}

function normalizeXTweet(tweet, userById) {
  if (!tweet) return null;
  const user = userById[tweet.author_id] || {};
  const username = String(user.username || '').trim();
  return createBasePost('x', {
    nativeId: tweet.id,
    url: username ? `https://x.com/${username}/status/${tweet.id}` : '',
    text: tweet.text || '',
    authorName: user.name || username || 'X account',
    authorHandle: username ? `@${username}` : '',
    publishedAt: tweet.created_at,
    profileLocation: user.location || '',
    language: tweet.lang || '',
    engagement: {
      likes: Number(tweet.public_metrics?.like_count || 0) || undefined,
      replies: Number(tweet.public_metrics?.reply_count || 0) || undefined,
      reposts: Number(tweet.public_metrics?.retweet_count || 0) || undefined,
      views: Number(tweet.public_metrics?.impression_count || 0) || undefined,
    },
  });
}

async function fetchJson(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data && typeof data.error === 'string'
        ? data.error
        : `${response.status} ${response.statusText}`.trim();
      const error = new Error(message || `Request failed for ${url}`);
      error.statusCode = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function createSocialMonitorRelay(options = {}) {
  const fetchJsonImpl = typeof options.fetchJson === 'function' ? options.fetchJson : fetchJson;
  const webSocketFactory = typeof options.webSocketFactory === 'function'
    ? options.webSocketFactory
    : (url, socketOptions) => new WebSocket(url, socketOptions);
  const enableBluesky = options.enableBluesky !== false;
  const enableMastodon = options.enableMastodon !== false;
  const enableYouTube = options.enableYouTube !== false;
  const enableReddit = options.enableReddit !== false;
  const enableX = options.enableX !== false;
  const terms = parseCsvEnv(process.env.SOCIAL_MONITOR_TERMS, DEFAULT_TERMS).map((term) => term.toLowerCase());
  const mastodonInstances = parseCsvEnv(process.env.SOCIAL_MASTODON_INSTANCES, DEFAULT_MASTODON_INSTANCES);
  const mastodonTags = parseCsvEnv(process.env.SOCIAL_MASTODON_TAGS, DEFAULT_MASTODON_TAGS);
  const redditSubreddits = parseCsvEnv(process.env.SOCIAL_REDDIT_SUBREDDITS, DEFAULT_REDDIT_SUBREDDITS);
  const redditTerms = parseCsvEnv(process.env.SOCIAL_REDDIT_TERMS, DEFAULT_REDDIT_TERMS);
  const youtubeTerms = parseCsvEnv(process.env.SOCIAL_YOUTUBE_TERMS, DEFAULT_YOUTUBE_TERMS);
  const youtubeApiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  const xBearerToken = String(process.env.X_BEARER_TOKEN || '').trim();
  const maxBufferedPosts = Math.max(200, Number(process.env.SOCIAL_MONITOR_BUFFER_LIMIT || DEFAULT_BUFFER_LIMIT));
  const snapshotLimit = Math.max(50, Number(process.env.SOCIAL_MONITOR_SNAPSHOT_LIMIT || DEFAULT_SNAPSHOT_LIMIT));
  const blueskyJetstreamUrl = String(process.env.BLUESKY_JETSTREAM_URL || DEFAULT_BLUESKY_JETSTREAM_URL).trim();
  const blueskyApiBase = String(process.env.BLUESKY_API_BASE || DEFAULT_BLUESKY_API_BASE).trim().replace(/\/$/, '');
  const statuses = {
    bluesky: connectorStatus('bluesky', enableBluesky, enableBluesky ? 'idle' : 'disabled', enableBluesky ? 'Jetstream + recent search backfill' : 'Disabled for this relay'),
    mastodon: connectorStatus('mastodon', enableMastodon, enableMastodon ? 'idle' : 'disabled', enableMastodon ? `${mastodonInstances.length} instances` : 'Disabled for this relay'),
    youtube: connectorStatus('youtube', enableYouTube && !!youtubeApiKey, enableYouTube && youtubeApiKey ? 'idle' : 'disabled', enableYouTube && youtubeApiKey ? 'API key configured' : 'Set YOUTUBE_API_KEY to enable'),
    reddit: connectorStatus('reddit', enableReddit, enableReddit ? 'idle' : 'disabled', enableReddit ? `${redditSubreddits.length} subreddits` : 'Disabled for this relay'),
    x: connectorStatus('x', enableX && !!xBearerToken, enableX && xBearerToken ? 'idle' : 'disabled', enableX && xBearerToken ? 'Bearer token configured' : 'Set X_BEARER_TOKEN to enable'),
  };
  const posts = new Map();
  const timers = new Set();
  const blueskyProfiles = new Map();
  const pollLocks = new Map();
  const mastodonInstanceErrors = new Map();
  let started = false;
  let updatedAt = null;
  let blueskySocket = null;
  let blueskyReconnectTimer = null;
  let blueskyReconnectDelayMs = 2_000;

  function setConnectorSuccess(platform, fetchedCount, detail) {
    const status = statuses[platform];
    if (!status) return;
    status.state = platform === 'bluesky' ? (blueskySocket ? 'connected' : 'polling') : 'polling';
    status.lastSuccessAt = new Date().toISOString();
    status.lastError = null;
    status.lastErrorAt = null;
    if (typeof fetchedCount === 'number') {
      status.fetchedCount = fetchedCount;
    }
    if (detail) status.detail = detail;
  }

  function setConnectorError(platform, error, detail, state = 'degraded') {
    const status = statuses[platform];
    if (!status) return;
    status.state = status.enabled ? state : 'disabled';
    status.lastError = error instanceof Error ? error.message : String(error);
    status.lastErrorAt = new Date().toISOString();
    if (detail) status.detail = detail;
  }

  function trimBuffer() {
    const cutoff = Date.now() - SOCIAL_WINDOW_MS;
    const sorted = [...posts.values()].sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    for (const post of sorted) {
      if (posts.size <= maxBufferedPosts && new Date(post.publishedAt).getTime() >= cutoff) break;
      posts.delete(buildDedupKey(post));
    }
  }

  function upsertPost(post) {
    if (!post || !post.url) return false;
    if (!matchesAnyTerm(post.searchText || normalizeSocialSearchText(post), terms)) return false;
    const key = buildDedupKey(post);
    const existing = posts.get(key);
    const merged = existing ? {
      ...existing,
      ...post,
      engagement: {
        ...(existing.engagement || {}),
        ...(post.engagement || {}),
      },
    } : post;
    posts.set(key, merged);
    updatedAt = new Date().toISOString();
    const status = statuses[post.platform];
    if (status) status.lastItemAt = post.publishedAt;
    trimBuffer();
    return true;
  }

  function getSnapshot(limit = snapshotLimit) {
    trimBuffer();
    const recentPosts = [...posts.values()]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);
    return {
      ok: true,
      updatedAt,
      windowHours: 24,
      totalPosts: posts.size,
      terms,
      statuses: Object.values(statuses),
      posts: recentPosts,
    };
  }

  function getStatus() {
    trimBuffer();
    return {
      ok: true,
      updatedAt,
      windowHours: 24,
      totalPosts: posts.size,
      terms,
      statuses: Object.values(statuses),
    };
  }

  function getHealthSummary() {
    return {
      updatedAt,
      totalPosts: posts.size,
      connectors: Object.values(statuses).map((status) => ({
        platform: status.platform,
        enabled: status.enabled,
        state: status.state,
        lastSuccessAt: status.lastSuccessAt,
        lastError: status.lastError,
      })),
    };
  }

  async function resolveBlueskyProfile(did) {
    if (!did) return null;
    const cached = blueskyProfiles.get(did);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const promise = fetchJsonImpl(`${blueskyApiBase}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then((payload) => {
        const value = {
          handle: String(payload?.handle || '').trim(),
          displayName: String(payload?.displayName || payload?.handle || '').trim(),
        };
        blueskyProfiles.set(did, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
        return value;
      })
      .catch(() => null);
    blueskyProfiles.set(did, { value: promise, expiresAt: Date.now() + 60_000 });
    const value = await promise;
    if (value) {
      blueskyProfiles.set(did, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    } else {
      blueskyProfiles.delete(did);
    }
    return value;
  }

  async function runBlueskyBackfill() {
    const results = [];
    for (const term of terms.slice(0, 6)) {
      try {
        const payload = await fetchJsonImpl(`${blueskyApiBase}/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=20&sort=latest`, {}, 20_000);
        const normalized = Array.isArray(payload?.posts)
          ? payload.posts.map((post) => normalizeBlueskySearchPost(post)).filter(Boolean)
          : [];
        normalized.forEach((post) => upsertPost(post));
        results.push(normalized.length);
      } catch (error) {
        setConnectorError('bluesky', error, 'Recent search backfill failed');
      }
    }
    if (results.length > 0) {
      setConnectorSuccess('bluesky', results.reduce((sum, count) => sum + count, 0), 'Jetstream + recent search backfill');
    }
  }

  function scheduleBlueskyReconnect() {
    if (blueskyReconnectTimer) return;
    blueskyReconnectTimer = setTimeout(() => {
      blueskyReconnectTimer = null;
      connectBlueskyStream();
    }, blueskyReconnectDelayMs);
    timers.add(blueskyReconnectTimer);
    blueskyReconnectDelayMs = Math.min(blueskyReconnectDelayMs * 2, 60_000);
  }

  function clearBlueskyReconnect() {
    if (!blueskyReconnectTimer) return;
    clearTimeout(blueskyReconnectTimer);
    timers.delete(blueskyReconnectTimer);
    blueskyReconnectTimer = null;
  }

  function connectBlueskyStream() {
    clearBlueskyReconnect();
    if (blueskySocket) {
      try { blueskySocket.close(); } catch {}
      blueskySocket = null;
    }
    statuses.bluesky.state = 'polling';
    const socket = webSocketFactory(blueskyJetstreamUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    blueskySocket = socket;

    socket.on('open', () => {
      blueskyReconnectDelayMs = 2_000;
      statuses.bluesky.state = 'connected';
      statuses.bluesky.detail = 'Jetstream connected';
      statuses.bluesky.lastSuccessAt = new Date().toISOString();
    });

    socket.on('message', async (payload) => {
      try {
        const raw = JSON.parse(String(payload));
        const recordText = raw?.commit?.record?.text || '';
        if (!matchesAnyTerm(String(recordText).toLowerCase(), terms)) return;
        const profile = await resolveBlueskyProfile(String(raw.did || ''));
        const normalized = normalizeBlueskyJetstreamCommit(raw, profile);
        if (normalized && upsertPost(normalized)) {
          setConnectorSuccess('bluesky', statuses.bluesky.fetchedCount + 1, 'Jetstream connected');
        }
      } catch (error) {
        setConnectorError('bluesky', error, 'Jetstream message parse failed');
      }
    });

    socket.on('close', () => {
      if (blueskySocket === socket) blueskySocket = null;
      if (!started) return;
      statuses.bluesky.state = 'degraded';
      statuses.bluesky.detail = 'Jetstream reconnecting';
      scheduleBlueskyReconnect();
    });

    socket.on('error', (error) => {
      setConnectorError('bluesky', error, 'Jetstream error');
    });
  }

  async function runMastodonPoll() {
    const normalizedPosts = [];
    const failedInstances = [];
    for (const instance of mastodonInstances) {
      try {
        const publicTimeline = await fetchJsonImpl(`https://${instance}/api/v1/timelines/public?local=true&limit=20`, {}, 20_000);
        const timelineItems = Array.isArray(publicTimeline) ? publicTimeline : [];
        for (const status of timelineItems) {
          const normalized = normalizeMastodonStatus(status, instance);
          if (normalized) normalizedPosts.push(normalized);
        }

        for (const tag of mastodonTags.slice(0, 2)) {
          const tagTimeline = await fetchJsonImpl(`https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20`, {}, 20_000);
          const tagItems = Array.isArray(tagTimeline) ? tagTimeline : [];
          for (const status of tagItems) {
            const normalized = normalizeMastodonStatus(status, instance);
            if (normalized) normalizedPosts.push(normalized);
          }
        }
        mastodonInstanceErrors.delete(instance);
      } catch (error) {
        failedInstances.push(instance);
        mastodonInstanceErrors.set(instance, error instanceof Error ? error.message : String(error));
      }
    }

    dedupeNormalizedPosts(normalizedPosts).forEach((post) => upsertPost(post));
    if (failedInstances.length > 0) {
      setConnectorError('mastodon', new Error(`Failed on ${failedInstances.join(', ')}`), `${mastodonInstances.length - failedInstances.length}/${mastodonInstances.length} instances healthy`, failedInstances.length === mastodonInstances.length ? 'error' : 'degraded');
    }
    if (normalizedPosts.length > 0 || failedInstances.length < mastodonInstances.length) {
      setConnectorSuccess('mastodon', normalizedPosts.length, `${mastodonInstances.length - failedInstances.length}/${mastodonInstances.length} instances healthy`);
      if (failedInstances.length > 0) {
        statuses.mastodon.state = 'degraded';
      }
    }
  }

  async function runRedditPoll() {
    const normalizedPosts = [];
    let failedRequests = 0;
    let requestCount = 0;
    for (const subreddit of redditSubreddits) {
      for (const term of redditTerms) {
        requestCount += 1;
        try {
          const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=week&limit=12&raw_json=1`;
          const payload = await fetchJsonImpl(url, {}, 20_000);
          const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
          for (const child of children) {
            const normalized = normalizeRedditPost(child?.data, subreddit);
            if (normalized) normalizedPosts.push(normalized);
          }
        } catch (error) {
          failedRequests += 1;
          setConnectorError('reddit', error, 'Polling Reddit search listings', failedRequests === requestCount ? 'error' : 'degraded');
        }
      }
    }

    dedupeNormalizedPosts(normalizedPosts).forEach((post) => upsertPost(post));
    if (normalizedPosts.length > 0 || failedRequests < requestCount) {
      setConnectorSuccess('reddit', normalizedPosts.length, `${requestCount - failedRequests}/${requestCount} search requests healthy`);
      if (failedRequests > 0) statuses.reddit.state = 'degraded';
    }
  }

  async function runYouTubePoll() {
    if (!youtubeApiKey) return;
    const normalizedPosts = [];
    for (const term of youtubeTerms) {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=10&q=${encodeURIComponent(term)}&key=${encodeURIComponent(youtubeApiKey)}`;
      const payload = await fetchJsonImpl(url, {}, 20_000);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      for (const item of items) {
        const normalized = normalizeYouTubeItem(item);
        if (normalized) normalizedPosts.push(normalized);
      }
    }
    dedupeNormalizedPosts(normalizedPosts).forEach((post) => upsertPost(post));
    setConnectorSuccess('youtube', normalizedPosts.length, `${youtubeTerms.length} query terms`);
  }

  async function runXPoll() {
    if (!xBearerToken) return;
    const query = '(Renault OR Dacia OR Mobilize OR Ampere OR Horse OR "Luca de Meo") -is:retweet';
    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', '25');
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,lang');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'name,username,location');

    const payload = await fetchJsonImpl(url.toString(), {
      headers: { Authorization: `Bearer ${xBearerToken}` },
    }, 20_000);
    const userById = Object.create(null);
    const users = Array.isArray(payload?.includes?.users) ? payload.includes.users : [];
    for (const user of users) {
      if (user?.id) userById[user.id] = user;
    }
    const tweets = Array.isArray(payload?.data) ? payload.data : [];
    const normalizedPosts = tweets.map((tweet) => normalizeXTweet(tweet, userById)).filter(Boolean);
    normalizedPosts.forEach((post) => upsertPost(post));
    setConnectorSuccess('x', normalizedPosts.length, 'Recent search');
  }

  function schedulePolling(key, intervalMs, task) {
    const run = async () => {
      if (!started) return;
      if (pollLocks.get(key)) return;
      pollLocks.set(key, true);
      try {
        await task();
      } catch (error) {
        setConnectorError(key, error, `Polling failed for ${key}`, 'degraded');
      } finally {
        pollLocks.set(key, false);
      }
    };
    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    timers.add(timer);
  }

  function start() {
    if (started) return;
    started = true;
    if (enableBluesky) {
      void runBlueskyBackfill();
      schedulePolling('bluesky', BLUESKY_BACKFILL_INTERVAL_MS, runBlueskyBackfill);
      connectBlueskyStream();
    }
    if (enableMastodon) {
      schedulePolling('mastodon', MASTODON_POLL_MS, runMastodonPoll);
    }
    if (enableReddit) {
      schedulePolling('reddit', REDDIT_POLL_MS, runRedditPoll);
    }
    if (enableYouTube && youtubeApiKey) {
      schedulePolling('youtube', YOUTUBE_POLL_MS, runYouTubePoll);
    }
    if (enableX && xBearerToken) {
      schedulePolling('x', X_POLL_MS, runXPoll);
    }
  }

  function stop() {
    started = false;
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers.clear();
    clearBlueskyReconnect();
    if (blueskySocket) {
      try { blueskySocket.close(); } catch {}
      blueskySocket = null;
    }
  }

  return {
    start,
    stop,
    getSnapshot,
    getStatus,
    getHealthSummary,
    _state: {
      terms,
      statuses,
      posts,
    },
  };
}

module.exports = {
  createSocialMonitorRelay,
  dedupeNormalizedPosts,
  normalizeSocialSearchText,
  normalizeBlueskySearchPost,
  normalizeMastodonStatus,
  normalizeYouTubeItem,
  normalizeRedditPost,
  normalizeXTweet,
};
