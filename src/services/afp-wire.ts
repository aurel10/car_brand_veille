/**
 * AFP Wire News — client-side service
 *
 * Reads AFP seed data from bootstrap hydration cache and converts
 * AFP articles into NewsItem[] for use in crisis panels and the
 * dedicated AFP Wire panel.
 */

import { getHydratedData } from '@/services/bootstrap';
import type { NewsItem, ThreatLevel, EventCategory, ThreatClassification } from '@/types';

// ─── AFP seed data types ─────────────────────────────────────────────────────

export interface AfpArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  image: string;
  language: string;
  tone: number;
  urgency: number;
  iptcCodes: string[];
  slug: string;
  afpId: string;
  country: string;
  product: string;
  abstract?: string;
  body?: string;
}

export interface AfpQueryResult {
  id: string;
  category: string;
  priority: string;
  label: string;
  lang: string;
  articles: AfpArticle[];
  articleCount: number;
  fetchedAt: string;
  error?: string;
}

export interface AfpSeedData {
  queries: AfpQueryResult[];
  alerts: Array<{ level: string; queryId: string; label: string; message: string }>;
  summary: { totalQueries: number; totalArticles: number };
  fetchedAt: string;
}

// ─── Bootstrap hydration ─────────────────────────────────────────────────────

export function getAfpSeedData(): AfpSeedData | null {
  const data = getHydratedData('afpRenault') as AfpSeedData | undefined;
  if (!data?.queries?.length) return null;
  return data;
}

/**
 * Fallback: fetch AFP data directly via dev server proxy when bootstrap has no data.
 * Only works in dev mode (Vite serves /api/afp-direct).
 */
export async function fetchAfpDirect(): Promise<AfpSeedData | null> {
  try {
    const resp = await fetch('/api/afp-direct', { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as AfpSeedData;
    if (!data?.queries?.length) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Category mapping ────────────────────────────────────────────────────────

const URGENCY_TO_LEVEL: Record<number, ThreatLevel> = {
  1: 'critical', // FLASH
  2: 'high',     // ALERT
  3: 'medium',   // URGENT
  4: 'low',      // LEAD
};

const CATEGORY_MAP: Record<string, EventCategory> = {
  labor: 'labor',
  financial: 'economic',
  legal: 'regulatory',
  product: 'product',
  geopolitical: 'supply-chain',
  sentiment: 'reputation',
};

function mapThreat(category: string, urgency: number): ThreatClassification {
  return {
    level: URGENCY_TO_LEVEL[urgency] || 'medium',
    category: CATEGORY_MAP[category] || 'general',
    confidence: 0.8,
    source: 'keyword',
  };
}

// ─── Converters ──────────────────────────────────────────────────────────────

export function afpArticleToNewsItem(article: AfpArticle, category: string): NewsItem {
  return {
    source: 'AFP',
    title: article.title,
    link: article.url || '#',
    pubDate: new Date(article.date || Date.now()),
    isAlert: article.urgency <= 2,
    searchText: `${article.title} ${article.slug}`,
    lang: article.language || undefined,
    imageUrl: article.image || undefined,
    threat: mapThreat(category, article.urgency),
  };
}

/**
 * Flatten all AFP seed data into deduplicated NewsItem[].
 */
export function flattenAfpToNewsItems(data: AfpSeedData): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const query of data.queries) {
    for (const article of query.articles || []) {
      const key = article.afpId || article.title;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(afpArticleToNewsItem(article, query.category));
    }
  }

  return items;
}
