import type {
  BrandwatchAlert,
  BrandwatchQuery,
  EntityThreatMatrixRow,
  MentionTrendPoint,
  NewsItem,
  RenaultSite,
  ThreatField,
  ThreatLevel,
  TrackedEntity,
} from '@/types';
import { RENAULT_SITES, RENAULT_THREAT_FIELDS, RENAULT_TRACKED_ENTITIES } from '@/config/renault-watch';
import { classifyByKeyword } from '@/services/threat-classifier';
import { evaluateBooleanQuery, parseBooleanQuery } from './query';
import { loadBrandwatchQueries } from './store';

export interface WeakSignalEntry {
  id: string;
  label: string;
  severity: ThreatLevel;
  recentCount: number;
  previousCount: number;
  delta: number;
  sampleTitle: string;
  entityNames: string[];
  threatId?: string;
}

export interface BrandwatchSnapshot {
  alerts: BrandwatchAlert[];
  weakSignals: WeakSignalEntry[];
  matrixRows: EntityThreatMatrixRow[];
  trendPoints: MentionTrendPoint[];
  queryCounts: Record<string, number>;
  compilationErrors: Record<string, string>;
}

type MatchedItem = {
  item: NewsItem;
  threatLevel: ThreatLevel;
  entities: TrackedEntity[];
  threats: ThreatField[];
  queryIds: string[];
};

const THREAT_RANK: Record<ThreatLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchKeyword(text: string, keyword: string): boolean {
  const escaped = escapeRegex(keyword.toLowerCase());
  const boundarySafe = /^[\p{L}\p{N}-]+$/u.test(keyword);
  const regex = new RegExp(boundarySafe ? `\\b${escaped}\\b` : escaped, 'iu');
  return regex.test(text);
}

function matchEntities(text: string): TrackedEntity[] {
  return RENAULT_TRACKED_ENTITIES.filter((entity) => (
    [entity.name, ...entity.aliases, ...(entity.keywords ?? [])]
      .filter(Boolean)
      .some((keyword) => matchKeyword(text, keyword))
  ));
}

export function getMatchedRenaultEntitiesForItem(item: NewsItem): TrackedEntity[] {
  const text = [item.title, item.source, item.locationName, item.searchText].filter(Boolean).join(' ').toLowerCase();
  return matchEntities(text);
}

export function isRenaultRelevantNewsItem(item: NewsItem): boolean {
  return getMatchedRenaultEntitiesForItem(item).length > 0;
}

function matchThreatFields(text: string): ThreatField[] {
  return RENAULT_THREAT_FIELDS.filter((field) => field.keywords.some((keyword) => matchKeyword(text, keyword)));
}

function scoreThreatLevel(item: NewsItem, threats: ThreatField[]): ThreatLevel {
  const classified = item.threat?.level ?? classifyByKeyword(item.title, 'renault').level;
  const strongestThreat = threats.reduce<ThreatLevel>((best, threat) => (
    THREAT_RANK[threat.severity ?? 'medium'] > THREAT_RANK[best] ? (threat.severity ?? 'medium') : best
  ), classified);
  return THREAT_RANK[strongestThreat] > THREAT_RANK[classified] ? strongestThreat : classified;
}

function findSiteForEntity(entityId?: string): { lat?: number; lon?: number } {
  if (!entityId) return {};
  const site = RENAULT_SITES.find((candidate) => candidate.entityId === entityId);
  return site ? { lat: site.lat, lon: site.lon } : {};
}

function toBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getQueryMatches(item: NewsItem, entities: TrackedEntity[], threats: ThreatField[], queries: BrandwatchQuery[], compilationErrors: Record<string, string>): string[] {
  const text = [item.title, item.source, item.locationName, item.searchText].filter(Boolean).join(' ').toLowerCase();
  const themeFields = [
    item.threat?.category,
    ...threats.map((threat) => threat.label),
    ...threats.map((threat) => threat.category),
  ].filter(Boolean) as string[];
  const orgFields = entities
    .filter((entity) => entity.type === 'brand' || entity.type === 'supplier' || entity.type === 'partner')
    .map((entity) => entity.name);
  const personFields = entities.filter((entity) => entity.type === 'executive').map((entity) => entity.name);
  const locationFields = [
    item.locationName,
    ...entities.filter((entity) => entity.type === 'factory').map((entity) => entity.city ?? entity.name),
  ].filter(Boolean) as string[];

  const matches: string[] = [];
  for (const query of queries) {
    if (!query.enabled) continue;
    if (query.mode === 'sql') continue;
    try {
      const ast = parseBooleanQuery(query.query);
      if (evaluateBooleanQuery(ast, {
        text,
        theme: themeFields,
        org: orgFields,
        person: personFields,
        location: locationFields,
      })) {
        matches.push(query.id);
      }
    } catch (error) {
      compilationErrors[query.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return matches;
}

function buildMatchedItems(news: NewsItem[], queries: BrandwatchQuery[]): { items: MatchedItem[]; compilationErrors: Record<string, string> } {
  const compilationErrors: Record<string, string> = {};
  const items = news
    .map((item) => {
      const text = [item.title, item.source, item.locationName, item.searchText].filter(Boolean).join(' ').toLowerCase();
      const entities = getMatchedRenaultEntitiesForItem(item);
      const threats = matchThreatFields(text);
      const queryIds = getQueryMatches(item, entities, threats, queries, compilationErrors);
      if (entities.length === 0 && threats.length === 0 && queryIds.length === 0) return null;
      return {
        item,
        entities,
        threats,
        queryIds,
        threatLevel: scoreThreatLevel(item, threats),
      };
    })
    .filter((item): item is MatchedItem => !!item);

  return { items, compilationErrors };
}

function buildAlerts(items: MatchedItem[]): BrandwatchAlert[] {
  const grouped = new Map<string, MatchedItem[]>();
  for (const matched of items) {
    const primaryEntity = matched.entities[0]?.id ?? 'unassigned';
    const primaryThreat = matched.threats[0]?.id ?? matched.item.threat?.category ?? 'general';
    const key = `${primaryEntity}::${primaryThreat}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(matched);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => b.item.pubDate.getTime() - a.item.pubDate.getTime());
      const primary = sorted[0]!;
      const primaryEntity = primary.entities[0];
      const primaryThreat = primary.threats[0];
      const entityNames = [...new Set(group.flatMap((entry) => entry.entities.map((entity) => entity.name)))];
      const queryIds = [...new Set(group.flatMap((entry) => entry.queryIds))];
      const severity = group.reduce<ThreatLevel>((best, entry) => (
        THREAT_RANK[entry.threatLevel] > THREAT_RANK[best] ? entry.threatLevel : best
      ), 'info');
      const subjectParts = [primaryEntity?.name, primaryThreat?.label].filter(Boolean);
      const summary = [
        entityNames.slice(0, 3).join(', '),
        `${group.length} matching headlines`,
        primary.item.source,
      ].filter(Boolean).join(' · ');
      return {
        id: key,
        subject: subjectParts.length > 0 ? subjectParts.join(' · ') : primary.item.title,
        summary,
        severity,
        theme: primaryThreat?.category ?? primary.item.threat?.category ?? 'general',
        entityIds: [...new Set(group.flatMap((entry) => entry.entities.map((entity) => entity.id)))],
        queryIds,
        matchCount: group.length,
        items: sorted.map((entry) => entry.item),
        primaryEntityId: primaryEntity?.id,
        primaryThreatId: primaryThreat?.id,
        ...findSiteForEntity(primaryEntity?.id),
      } satisfies BrandwatchAlert;
    })
    .sort((a, b) => {
      const severityDelta = THREAT_RANK[b.severity] - THREAT_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.items[0]?.pubDate.getTime() ?? 0) - (a.items[0]?.pubDate.getTime() ?? 0);
    });
}

function buildWeakSignals(items: MatchedItem[]): WeakSignalEntry[] {
  const now = Date.now();
  const recentWindowMs = 48 * 60 * 60 * 1000;
  const previousStart = now - recentWindowMs * 2;
  const recentStart = now - recentWindowMs;

  const buckets = new Map<string, { threat: ThreatField; recent: MatchedItem[]; previous: MatchedItem[] }>();

  for (const matched of items) {
    for (const field of matched.threats) {
      const bucket = buckets.get(field.id) ?? { threat: field, recent: [], previous: [] };
      const ts = matched.item.pubDate.getTime();
      if (ts >= recentStart) {
        bucket.recent.push(matched);
      } else if (ts >= previousStart) {
        bucket.previous.push(matched);
      }
      buckets.set(field.id, bucket);
    }
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.recent.length > 0 && bucket.recent.length <= 5 && bucket.recent.length > bucket.previous.length)
    .map((bucket) => {
      const lead = bucket.recent[0]!;
      const entityNames = [...new Set(bucket.recent.flatMap((item) => item.entities.map((entity) => entity.name)))];
      return {
        id: bucket.threat.id,
        label: bucket.threat.label,
        severity: bucket.threat.severity ?? lead.threatLevel,
        recentCount: bucket.recent.length,
        previousCount: bucket.previous.length,
        delta: bucket.recent.length - bucket.previous.length,
        sampleTitle: lead.item.title,
        entityNames,
        threatId: bucket.threat.id,
      };
    })
    .sort((a, b) => {
      const severityDelta = THREAT_RANK[b.severity] - THREAT_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return b.delta - a.delta;
    })
    .slice(0, 8);
}

function buildMatrix(items: MatchedItem[]): EntityThreatMatrixRow[] {
  const matrix = new Map<string, EntityThreatMatrixRow>();

  for (const matched of items) {
    for (const entity of matched.entities) {
      const row = matrix.get(entity.id) ?? {
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        counts: {},
        totalMentions: 0,
        hotThreatIds: [],
      };
      row.totalMentions += 1;
      for (const threat of matched.threats) {
        row.counts[threat.id] = (row.counts[threat.id] ?? 0) + 1;
      }
      matrix.set(entity.id, row);
    }
  }

  return [...matrix.values()]
    .map((row) => ({
      ...row,
      hotThreatIds: Object.entries(row.counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id),
    }))
    .sort((a, b) => b.totalMentions - a.totalMentions);
}

function buildTrendPoints(items: MatchedItem[], queries: BrandwatchQuery[]): MentionTrendPoint[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const points = new Map<string, number>();

  for (const matched of items) {
    const ts = matched.item.pubDate.getTime();
    if (ts < cutoff) continue;
    const bucket = toBucket(matched.item.pubDate);
    for (const queryId of matched.queryIds) {
      const key = `${bucket}::${queryId}`;
      points.set(key, (points.get(key) ?? 0) + 1);
    }
  }

  const fallbackQuery = queries.find((query) => query.enabled);
  if (points.size === 0 && fallbackQuery) {
    const buckets = new Map<string, number>();
    for (const matched of items) {
      const bucket = toBucket(matched.item.pubDate);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    for (const [bucket, count] of buckets) {
      points.set(`${bucket}::${fallbackQuery.id}`, count);
    }
  }

  return [...points.entries()]
    .map(([key, count]) => {
      const separator = key.indexOf('::');
      const bucket = separator === -1 ? key : key.slice(0, separator);
      const queryId = separator === -1 ? 'default-query' : key.slice(separator + 2);
      return { bucket, count, queryId };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function buildBrandwatchSnapshot(news: NewsItem[], queries = loadBrandwatchQueries()): BrandwatchSnapshot {
  const enabledQueries = queries.filter((query) => query.enabled);
  const { items, compilationErrors } = buildMatchedItems(news, enabledQueries);
  const alerts = buildAlerts(items).slice(0, 20);
  const weakSignals = buildWeakSignals(items);
  const matrixRows = buildMatrix(items).slice(0, 12);
  const trendPoints = buildTrendPoints(items, enabledQueries);
  const queryCounts = Object.fromEntries(enabledQueries.map((query) => [query.id, 0]));

  for (const item of items) {
    for (const queryId of item.queryIds) {
      queryCounts[queryId] = (queryCounts[queryId] ?? 0) + 1;
    }
  }

  return {
    alerts,
    weakSignals,
    matrixRows,
    trendPoints,
    queryCounts,
    compilationErrors,
  };
}

export function getThreatFieldById(id: string): ThreatField | undefined {
  return RENAULT_THREAT_FIELDS.find((field) => field.id === id);
}

export function getTrackedEntityById(id: string): TrackedEntity | undefined {
  return RENAULT_TRACKED_ENTITIES.find((entity) => entity.id === id);
}

export function getRenaultSiteByEntityId(id: string): RenaultSite | undefined {
  return RENAULT_SITES.find((site) => site.entityId === id);
}
