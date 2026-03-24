import type { BrandwatchQuery, BrandwatchQueryField, SocialConnectorStatus, SocialPlatform, SocialPost, SocialSnapshot } from '@/types';
import { evaluateBooleanQuery, parseBooleanQuery } from '@/services/brandwatch/query';

const LOCAL_RELAY_FALLBACK = 'http://localhost:3004';
const CACHE_TTL_MS = 15_000;

export interface SocialFetchResult {
  relayAvailable: boolean;
  snapshot: SocialSnapshot | null;
  error?: string;
}

export interface SocialMatchedPost extends SocialPost {
  matchedQueryIds: string[];
  matchedQueryNames: string[];
}

export interface SocialTrendBucket {
  bucket: string;
  total: number;
  platformCounts: Partial<Record<SocialPlatform, number>>;
}

export interface SocialAuthorAggregate {
  id: string;
  label: string;
  handle?: string;
  count: number;
  latestAt: string;
  platforms: SocialPlatform[];
}

export interface SocialMonitorView {
  relayAvailable: boolean;
  error?: string;
  updatedAt: string | null;
  totalRawPosts: number;
  totalMatchedPosts: number;
  enabledQueryCount: number;
  statuses: SocialConnectorStatus[];
  matchedPosts: SocialMatchedPost[];
  trendBuckets: SocialTrendBucket[];
  platformCounts: Partial<Record<SocialPlatform, number>>;
  topAuthors: SocialAuthorAggregate[];
}

let cachedAt = 0;
let cachedSnapshot: SocialSnapshot | null = null;
let inFlightSnapshot: Promise<SocialFetchResult> | null = null;

function normalizeRelayBaseUrl(rawUrl: string): string {
  return rawUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '');
}

function isLocalhostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getDirectRelayBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (!isLocalhostName(window.location.hostname)) return null;

  const configuredRelay = String(import.meta.env.VITE_WS_RELAY_URL || '').trim();
  if (configuredRelay) {
    const normalized = normalizeRelayBaseUrl(configuredRelay);
    try {
      const relayUrl = new URL(normalized);
      if (isLocalhostName(relayUrl.hostname)) {
        return normalized;
      }
    } catch {
      // Ignore invalid relay URL and use localhost below.
    }
  }

  return LOCAL_RELAY_FALLBACK;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeSnapshot(payload: Record<string, unknown>): SocialSnapshot {
  const statuses = Array.isArray(payload.statuses)
    ? payload.statuses as SocialConnectorStatus[]
    : [];
  const posts = Array.isArray(payload.posts)
    ? payload.posts as SocialPost[]
    : [];
  return {
    ok: payload.ok !== false,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
    windowHours: Number(payload.windowHours || 24),
    totalPosts: Number(payload.totalPosts || posts.length),
    terms: Array.isArray(payload.terms) ? payload.terms.map((term) => String(term)) : [],
    statuses,
    posts,
  };
}

export async function fetchSocialMonitorSnapshot(force = false): Promise<SocialFetchResult> {
  const relayBaseUrl = getDirectRelayBaseUrl();
  if (!relayBaseUrl) {
    return {
      relayAvailable: false,
      snapshot: null,
      error: 'Social monitoring is local-only in v1. Start the local relay on localhost:3004.',
    };
  }

  if (!force && cachedSnapshot && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { relayAvailable: true, snapshot: cachedSnapshot };
  }

  if (!force && inFlightSnapshot) {
    return inFlightSnapshot;
  }

  inFlightSnapshot = (async () => {
    const response = await fetch(`${relayBaseUrl}/social-monitor/v1/snapshot`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await readJsonSafe(response);
    if (!response.ok) {
      return {
        relayAvailable: true,
        snapshot: null,
        error: String(payload.error || `Social relay request failed (${response.status})`),
      };
    }
    const snapshot = normalizeSnapshot(payload);
    cachedAt = Date.now();
    cachedSnapshot = snapshot;
    return { relayAvailable: true, snapshot };
  })();

  try {
    return await inFlightSnapshot;
  } catch (error) {
    return {
      relayAvailable: false,
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    inFlightSnapshot = null;
  }
}

function normalizeText(value: string | undefined): string {
  return String(value || '').toLowerCase().trim();
}

function buildQueryFields(post: SocialPost): Partial<Record<BrandwatchQueryField, string | string[]>> {
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
  return {
    text: [
      post.searchText,
      post.text,
      hashtags.map((tag) => `#${tag}`).join(' '),
      post.authorName,
      post.authorHandle,
      post.channelTitle,
      post.profileLocation,
      post.subreddit,
      post.instance,
    ].filter(Boolean).join(' ').toLowerCase(),
    theme: hashtags.map((tag) => normalizeText(tag)).filter(Boolean),
    org: [post.channelTitle, post.subreddit, post.instance].map(normalizeText).filter(Boolean),
    person: [post.authorName, post.authorHandle].map(normalizeText).filter(Boolean),
    location: [post.profileLocation, post.instance].map(normalizeText).filter(Boolean),
  };
}

export function dedupeSocialPosts(posts: SocialPost[]): SocialPost[] {
  const deduped = new Map<string, SocialPost>();
  for (const post of posts) {
    const key = `${post.platform}:${post.url || post.nativeId || post.id}`;
    if (!key) continue;
    if (deduped.has(key)) continue;
    deduped.set(key, post);
  }
  return [...deduped.values()];
}

export function buildSocialMonitorView(
  snapshot: SocialSnapshot | null,
  queries: BrandwatchQuery[],
  relayError?: string | null,
): SocialMonitorView {
  const booleanQueries = queries.filter((query) => query.enabled && (query.mode ?? 'boolean') === 'boolean');
  const compilationErrors: Record<string, string> = {};
  const normalizedPosts = dedupeSocialPosts(snapshot?.posts ?? []);
  const matchedPosts: SocialMatchedPost[] = [];

  for (const post of normalizedPosts) {
    const fields = buildQueryFields(post);
    const matchedQueryIds: string[] = [];
    const matchedQueryNames: string[] = [];

    for (const query of booleanQueries) {
      try {
        const ast = parseBooleanQuery(query.query);
        if (evaluateBooleanQuery(ast, fields)) {
          matchedQueryIds.push(query.id);
          matchedQueryNames.push(query.name);
        }
      } catch (error) {
        compilationErrors[query.id] = error instanceof Error ? error.message : String(error);
      }
    }

    if (matchedQueryIds.length === 0) continue;
    matchedPosts.push({
      ...post,
      matchedQueryIds,
      matchedQueryNames,
    });
  }

  matchedPosts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const platformCounts: Partial<Record<SocialPlatform, number>> = {};
  const trendByHour = new Map<string, SocialTrendBucket>();
  const authors = new Map<string, SocialAuthorAggregate>();

  for (const post of matchedPosts) {
    platformCounts[post.platform] = (platformCounts[post.platform] ?? 0) + 1;
    const bucket = new Date(post.publishedAt).toISOString().slice(0, 13) + ':00';
    const existingBucket = trendByHour.get(bucket) ?? {
      bucket,
      total: 0,
      platformCounts: {},
    };
    existingBucket.total += 1;
    existingBucket.platformCounts[post.platform] = (existingBucket.platformCounts[post.platform] ?? 0) + 1;
    trendByHour.set(bucket, existingBucket);

    const authorId = `${post.platform}:${post.authorHandle || post.authorName}`;
    const author = authors.get(authorId) ?? {
      id: authorId,
      label: post.authorName,
      handle: post.authorHandle,
      count: 0,
      latestAt: post.publishedAt,
      platforms: [],
    };
    author.count += 1;
    if (!author.platforms.includes(post.platform)) author.platforms.push(post.platform);
    if (new Date(post.publishedAt).getTime() > new Date(author.latestAt).getTime()) {
      author.latestAt = post.publishedAt;
    }
    authors.set(authorId, author);
  }

  const trendBuckets = [...trendByHour.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .slice(-24);

  const topAuthors = [...authors.values()]
    .sort((a, b) => {
      const countDelta = b.count - a.count;
      if (countDelta !== 0) return countDelta;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    })
    .slice(0, 8);

  return {
    relayAvailable: !!snapshot,
    error: relayError || Object.values(compilationErrors)[0],
    updatedAt: snapshot?.updatedAt ?? null,
    totalRawPosts: snapshot?.totalPosts ?? normalizedPosts.length,
    totalMatchedPosts: matchedPosts.length,
    enabledQueryCount: booleanQueries.length,
    statuses: snapshot?.statuses ?? [],
    matchedPosts,
    trendBuckets,
    platformCounts,
    topAuthors,
  };
}
