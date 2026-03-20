import type { BrandwatchQuery } from '@/types';
import { RENAULT_QUERY_TEMPLATES } from '@/config/renault-watch';
import { generateId } from '@/utils';

const BRANDWATCH_STORAGE_KEY = 'worldmonitor-brandwatch-queries';
const BRANDWATCH_EVENT = 'brandwatch-queries-changed';

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultQueries(): BrandwatchQuery[] {
  const createdAt = nowIso();
  return RENAULT_QUERY_TEMPLATES.slice(0, 4).map((template) => ({
    id: generateId(),
    name: template.name,
    query: template.query,
    mode: 'boolean',
    enabled: true,
    color: template.color,
    description: template.description,
    templateId: template.id,
    createdAt,
    updatedAt: createdAt,
  }));
}

export function loadBrandwatchQueries(): BrandwatchQuery[] {
  try {
    const raw = localStorage.getItem(BRANDWATCH_STORAGE_KEY);
    if (!raw) return createDefaultQueries();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultQueries();
    return parsed
      .filter(Boolean)
      .map((query) => ({
        ...query,
        mode: query?.mode === 'sql' ? 'sql' : 'boolean',
      }));
  } catch {
    return createDefaultQueries();
  }
}

export function saveBrandwatchQueries(queries: BrandwatchQuery[]): void {
  localStorage.setItem(BRANDWATCH_STORAGE_KEY, JSON.stringify(queries));
  window.dispatchEvent(new CustomEvent(BRANDWATCH_EVENT, { detail: queries }));
}

export function subscribeBrandwatchQueries(listener: (queries: BrandwatchQuery[]) => void): () => void {
  const handler = (event: Event): void => {
    const custom = event as CustomEvent<BrandwatchQuery[]>;
    listener(custom.detail ?? loadBrandwatchQueries());
  };
  window.addEventListener(BRANDWATCH_EVENT, handler);
  return () => window.removeEventListener(BRANDWATCH_EVENT, handler);
}

export function upsertBrandwatchQuery(
  partial: Pick<BrandwatchQuery, 'name' | 'query' | 'color'> & Partial<BrandwatchQuery>,
): BrandwatchQuery[] {
  const queries = loadBrandwatchQueries();
  const timestamp = nowIso();
  const next: BrandwatchQuery = partial.id
    ? {
      ...(queries.find((query) => query.id === partial.id) ?? queries[0] ?? createDefaultQueries()[0]!),
      ...partial,
      updatedAt: timestamp,
    }
    : {
      id: generateId(),
      name: partial.name,
      query: partial.query,
      mode: partial.mode ?? 'boolean',
      color: partial.color,
      enabled: partial.enabled ?? true,
      description: partial.description,
      templateId: partial.templateId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

  const updated = partial.id
    ? queries.map((query) => query.id === partial.id ? next : query)
    : [next, ...queries];
  saveBrandwatchQueries(updated);
  return updated;
}

export function toggleBrandwatchQuery(id: string, enabled: boolean): BrandwatchQuery[] {
  const updated = loadBrandwatchQueries().map((query) => (
    query.id === id
      ? { ...query, enabled, updatedAt: nowIso() }
      : query
  ));
  saveBrandwatchQueries(updated);
  return updated;
}

export function removeBrandwatchQuery(id: string): BrandwatchQuery[] {
  const updated = loadBrandwatchQueries().filter((query) => query.id !== id);
  saveBrandwatchQueries(updated.length > 0 ? updated : createDefaultQueries());
  return loadBrandwatchQueries();
}
