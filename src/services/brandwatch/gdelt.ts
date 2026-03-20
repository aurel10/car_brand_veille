import { toApiUrl } from '@/services/runtime';
import type { BrandwatchQuery, MentionTrendPoint, NewsItem } from '@/types';
import { compileBrandwatchQuery, validateBrandwatchSql } from './query';

const CACHE_TTL_MS = 60_000;
const LOCAL_RELAY_FALLBACK = 'http://localhost:3004';

type QueryExecutionResult = {
  queryId: string;
  relayAvailable: boolean;
  executed: boolean;
  totalMentions: number;
  trendPoints: MentionTrendPoint[];
  documents: NewsItem[];
  error?: string;
};

type EdgeExecutionResponse = {
  relayAvailable?: boolean;
  relayExecuted?: boolean;
  relayData?: {
    error?: string;
    points?: Array<{ bucket?: string; count?: number; mentions?: number }>;
    totalMentions?: number;
    rows?: Array<Record<string, unknown>>;
  } | null;
  error?: string;
};

type RelayQueryPayload = {
  points?: Array<{ bucket?: string; count?: number; mentions?: number }>;
  totalMentions?: number;
  rows?: Array<Record<string, unknown>>;
  error?: string;
};

export interface BrandwatchExecutionState {
  pending: boolean;
  relayAvailable: boolean;
  executedCount: number;
  updatedAt: string | null;
  queryCounts: Record<string, number>;
  trendPoints: MentionTrendPoint[];
  documentItems: NewsItem[];
  errors: Record<string, string>;
  statusMessage?: string;
}

let cachedKey = '';
let cachedAt = 0;
let cachedExecution: BrandwatchExecutionState | null = null;
let inFlightKey = '';
let inFlightExecution: Promise<BrandwatchExecutionState> | null = null;

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
      // Ignore invalid configured relay URL and fall back to localhost below.
    }
  }

  return LOCAL_RELAY_FALLBACK;
}

function normalizePoints(
  queryId: string,
  points: Array<{ bucket?: string; count?: number; mentions?: number }> | undefined,
): MentionTrendPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      bucket: String(point.bucket || ''),
      count: Number(point.count ?? point.mentions ?? 0),
      queryId,
    }))
    .filter((point) => point.bucket && Number.isFinite(point.count) && point.count >= 0)
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function getStringField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseBucketDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function toHostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'GDELT source';
  }
}

function toHeadlineLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const lastSegment = url.pathname.split('/').filter(Boolean).pop() || '';
    const decoded = decodeURIComponent(lastSegment)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (decoded && decoded.length >= 12) {
      return decoded.charAt(0).toUpperCase() + decoded.slice(1);
    }
    return url.hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

function normalizeDocumentItems(
  query: BrandwatchQuery,
  rows: Array<Record<string, unknown>> | undefined,
): NewsItem[] {
  if (!Array.isArray(rows)) return [];
  const items: NewsItem[] = [];
  for (const row of rows) {
    const link = getStringField(row, 'document_identifier', 'DocumentIdentifier');
    if (!link) continue;

    const timestamp = getStringField(row, 'document_timestamp');
    const bucket = getStringField(row, 'bucket');
    const organizations = getStringField(row, 'organizations');
    const persons = getStringField(row, 'persons');
    const themes = getStringField(row, 'themes');
    const locations = getStringField(row, 'locations');
    const sourceLabel = toHostLabel(link);
    const titleLabel = toHeadlineLabel(link);
    const contextualBits = [organizations, persons, themes]
      .map((value) => value.split(/[;,]/).map((part) => part.trim()).filter(Boolean)[0] || '')
      .filter(Boolean);

    items.push({
      source: `GDELT · ${sourceLabel}`,
      title: contextualBits.length > 0
        ? `${titleLabel} · ${contextualBits.slice(0, 2).join(' · ')}`
        : titleLabel,
      link,
      pubDate: parseBucketDate(timestamp || bucket),
      isAlert: false,
      searchText: [
        titleLabel,
        sourceLabel,
        organizations,
        persons,
        themes,
        locations,
        query.name,
        query.query,
      ].filter(Boolean).join(' '),
      locationName: locations.split(/[;,]/).map((part) => part.trim()).find(Boolean),
      monitorColor: query.color,
    });
  }
  return items;
}

function getExecutionCacheKey(queries: BrandwatchQuery[], days: number): string {
  return JSON.stringify({
    days,
    queries: queries
      .filter((query) => query.enabled)
      .map((query) => ({
        id: query.id,
        mode: query.mode ?? 'boolean',
        query: query.query,
        updatedAt: query.updatedAt,
      })),
  });
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function executeDirectRelayQuery(query: BrandwatchQuery, days: number): Promise<QueryExecutionResult> {
  const relayBaseUrl = getDirectRelayBaseUrl();
  if (!relayBaseUrl) {
    return {
      queryId: query.id,
      relayAvailable: false,
      executed: false,
      totalMentions: 0,
      trendPoints: [],
      documents: [],
      error: 'Local relay unavailable.',
    };
  }

  const isSqlMode = query.mode === 'sql';
  const compilation = isSqlMode
    ? {
      normalizedQuery: query.name || 'Manual SQL',
      bigQueryWhere: '',
      bigQuerySql: validateBrandwatchSql(query.query),
      bigQueryDocsSql: '',
    }
    : compileBrandwatchQuery(query.query, days);
  const response = await fetch(`${relayBaseUrl}/brandwatch/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: compilation.normalizedQuery,
      bigQueryWhere: compilation.bigQueryWhere,
      bigQuerySql: compilation.bigQuerySql,
      days,
      mode: isSqlMode ? 'sql' : 'timeline',
      queryMode: query.mode ?? 'boolean',
    }),
  });

  const payload = await readJsonSafe(response);
  if (!response.ok) {
    return {
      queryId: query.id,
      relayAvailable: true,
      executed: false,
      totalMentions: 0,
      trendPoints: [],
      documents: [],
      error: String(payload.error || `Relay request failed (${response.status})`),
    };
  }

  const points = normalizePoints(query.id, payload.points as Array<{ bucket?: string; count?: number; mentions?: number }> | undefined);
  let documents = normalizeDocumentItems(query, payload.rows as Array<Record<string, unknown>> | undefined);
  if (!isSqlMode && compilation.bigQueryDocsSql) {
    const documentsResponse = await fetch(`${relayBaseUrl}/brandwatch/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: `${compilation.normalizedQuery} documents`,
        bigQueryWhere: compilation.bigQueryWhere,
        bigQuerySql: compilation.bigQueryDocsSql,
        days,
        mode: 'documents',
        queryMode: query.mode ?? 'boolean',
      }),
    });
    const documentsPayload = await readJsonSafe(documentsResponse) as RelayQueryPayload;
    if (documentsResponse.ok) {
      documents = normalizeDocumentItems(query, documentsPayload.rows);
    }
  }
  return {
    queryId: query.id,
    relayAvailable: true,
    executed: true,
    totalMentions: Number(payload.totalMentions || points.reduce((sum, point) => sum + point.count, 0)),
    trendPoints: points,
    documents,
  };
}

async function executeEdgeQuery(query: BrandwatchQuery, days: number): Promise<QueryExecutionResult> {
  const isSqlMode = query.mode === 'sql';
  const compilation = isSqlMode
    ? {
      normalizedQuery: query.name || 'Manual SQL',
      bigQuerySql: validateBrandwatchSql(query.query),
      bigQueryDocsSql: '',
    }
    : compileBrandwatchQuery(query.query, days);
  const response = await fetch(toApiUrl('/api/brandwatch/v1/query'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: query.query,
      bigQuerySql: isSqlMode ? compilation.bigQuerySql : undefined,
      queryMode: query.mode ?? 'boolean',
      days,
      execute: true,
      mode: isSqlMode ? 'sql' : 'timeline',
    }),
  });

  const payload = await readJsonSafe(response) as EdgeExecutionResponse;
  if (!response.ok) {
    return {
      queryId: query.id,
      relayAvailable: Boolean(payload.relayAvailable),
      executed: false,
      totalMentions: 0,
      trendPoints: [],
      documents: [],
      error: String(payload.error || `Brandwatch query failed (${response.status})`),
    };
  }

  const relayData = payload.relayData;
  if (payload.relayExecuted && relayData) {
    const points = normalizePoints(query.id, relayData.points);
    let documents = normalizeDocumentItems(query, relayData.rows);
    if (!isSqlMode && compilation.bigQueryDocsSql) {
      const documentsResponse = await fetch(toApiUrl('/api/brandwatch/v1/query'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: `${compilation.normalizedQuery} documents`,
          bigQuerySql: compilation.bigQueryDocsSql,
          queryMode: 'sql',
          days,
          execute: true,
          mode: 'documents',
        }),
      });
      const documentsPayload = await readJsonSafe(documentsResponse) as EdgeExecutionResponse;
      if (documentsResponse.ok && documentsPayload.relayData) {
        documents = normalizeDocumentItems(query, documentsPayload.relayData.rows);
      }
    }
    return {
      queryId: query.id,
      relayAvailable: true,
      executed: true,
      totalMentions: Number(relayData.totalMentions || points.reduce((sum, point) => sum + point.count, 0)),
      trendPoints: points,
      documents,
      error: relayData.error,
    };
  }

  return {
    queryId: query.id,
    relayAvailable: Boolean(payload.relayAvailable),
    executed: false,
    totalMentions: 0,
    trendPoints: [],
    documents: [],
    error: payload.error || (payload.relayAvailable ? 'Relay execution did not complete.' : 'Relay unavailable.'),
  };
}

async function executeQuery(query: BrandwatchQuery, days: number): Promise<QueryExecutionResult> {
  try {
    if (getDirectRelayBaseUrl()) {
      return await executeDirectRelayQuery(query, days);
    }
    return await executeEdgeQuery(query, days);
  } catch (error) {
    return {
      queryId: query.id,
      relayAvailable: Boolean(getDirectRelayBaseUrl()),
      executed: false,
      totalMentions: 0,
      trendPoints: [],
      documents: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchBrandwatchGdeltExecution(
  queries: BrandwatchQuery[],
  days = 7,
): Promise<BrandwatchExecutionState> {
  const enabledQueries = queries.filter((query) => query.enabled);
  if (enabledQueries.length === 0) {
    return {
      pending: false,
      relayAvailable: true,
      executedCount: 0,
      updatedAt: null,
      queryCounts: {},
      trendPoints: [],
      documentItems: [],
      errors: {},
    };
  }

  const cacheKey = getExecutionCacheKey(enabledQueries, days);
  if (cachedExecution && cachedKey === cacheKey && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedExecution;
  }
  if (inFlightExecution && inFlightKey === cacheKey) {
    return inFlightExecution;
  }

  inFlightKey = cacheKey;
  inFlightExecution = (async () => {
    const results = await Promise.all(enabledQueries.map((query) => executeQuery(query, days)));
    const queryCounts: Record<string, number> = {};
    const errors: Record<string, string> = {};
    const trendPoints = results.flatMap((result) => result.trendPoints);
    const documentItems = results.flatMap((result) => result.documents);

    for (const result of results) {
      if (result.executed) {
        queryCounts[result.queryId] = result.totalMentions;
      }
      if (result.error) {
        errors[result.queryId] = result.error;
      }
    }

    const executedCount = results.filter((result) => result.executed).length;
    const relayAvailable = results.some((result) => result.relayAvailable);
    const firstError = Object.values(errors)[0];
    const execution: BrandwatchExecutionState = {
      pending: false,
      relayAvailable,
      executedCount,
      updatedAt: new Date().toISOString(),
      queryCounts,
      trendPoints: trendPoints.sort((a, b) => {
        const bucketDelta = a.bucket.localeCompare(b.bucket);
        if (bucketDelta !== 0) return bucketDelta;
        return String(a.queryId || '').localeCompare(String(b.queryId || ''));
      }),
      documentItems,
      errors,
      statusMessage: firstError
        ? firstError
        : !relayAvailable
        ? 'GDELT relay unavailable.'
        : executedCount === 0
          ? 'No BigQuery results returned yet.'
          : undefined,
    };

    cachedKey = cacheKey;
    cachedAt = Date.now();
    cachedExecution = execution;
    return execution;
  })();

  try {
    return await inFlightExecution;
  } finally {
    if (inFlightKey === cacheKey) {
      inFlightKey = '';
      inFlightExecution = null;
    }
  }
}
