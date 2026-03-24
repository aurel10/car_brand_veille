import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { h, replaceChildren } from '@/utils/dom-utils';
import { getThreatColor } from '@/services/threat-classifier';
import { getMatchedRenaultEntitiesForItem, isRenaultRelevantNewsItem } from '@/services/brandwatch/engine';

function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const unique: NewsItem[] = [];

  for (const item of [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())) {
    const key = (item.link || `${item.source}::${item.title}`).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const ALPINE_CONTEXT_TERMS = [
  'renault',
  'car',
  'cars',
  'automotive',
  'vehicle',
  'electric',
  'motorsport',
  'formula 1',
  'f1',
  'grand prix',
  'a110',
  'a290',
  'a390',
  'bwt alpine',
  'alpine team',
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesContextTerm(text: string, term: string): boolean {
  const escaped = escapeRegex(term.toLowerCase());
  const boundarySafe = /^[\p{L}\p{N} -]+$/u.test(term);
  const pattern = boundarySafe ? `\\b${escaped.replace(/\s+/g, '\\s+')}\\b` : escaped;
  return new RegExp(pattern, 'iu').test(text);
}

function isRelevantToRenaultWire(item: NewsItem): boolean {
  if (!isRenaultRelevantNewsItem(item)) return false;

  const entities = getMatchedRenaultEntitiesForItem(item);
  if (entities.length === 0) return true;

  const entityIds = new Set(entities.map((entity) => entity.id));
  if (!entityIds.has('alpine')) return true;
  if (entityIds.size > 1) return true;

  const text = [item.title, item.source, item.locationName, item.searchText].filter(Boolean).join(' ').toLowerCase();
  return ALPINE_CONTEXT_TERMS.some((term) => matchesContextTerm(text, term));
}

export class RenaultChronologyScreen extends Panel {
  constructor() {
    super({
      id: 'renault-chronology-screen',
      title: 'Renault News Wire',
      showCount: true,
      className: 'renault-chronology-panel',
    });
  }

  update(items: NewsItem[]): void {
    const orderedItems = dedupeNewsItems(items.filter(isRelevantToRenaultWire));
    this.setCount(orderedItems.length);

    if (orderedItems.length === 0) {
      this.setContent('<div class="empty-state">No Renault news collected yet.</div>');
      return;
    }

    const sourceCount = new Set(orderedItems.map((item) => item.source)).size;
    const children: Array<HTMLElement> = [
      h('div', { className: 'renault-wire-summary' },
        h('strong', null, `${orderedItems.length} headlines`),
        h('span', null, `${sourceCount} sources`),
        h('span', null, 'Most recent first'),
      ),
    ];

    let currentDay = '';
    for (const item of orderedItems) {
      const dayLabel = formatDayLabel(item.pubDate);
      if (dayLabel !== currentDay) {
        currentDay = dayLabel;
        children.push(
          h('div', { className: 'renault-wire-day' },
            h('span', null, dayLabel),
          ),
        );
      }

      const severity = item.threat?.level ?? (item.isAlert ? 'high' : 'info');
      children.push(
        h('article', { className: 'renault-wire-item' },
          h('div', { className: 'renault-wire-item-meta' },
            h('span', { className: 'renault-wire-source' }, item.source),
            item.lang ? h('span', { className: 'renault-wire-chip' }, item.lang.toUpperCase()) : false,
            item.locationName ? h('span', { className: 'renault-wire-chip' }, item.locationName) : false,
            item.threat?.category
              ? h('span', {
                className: 'renault-wire-chip renault-wire-chip-threat',
                style: `border-color:${getThreatColor(severity)}; color:${getThreatColor(severity)};`,
              }, item.threat.category.replace(/_/g, ' '))
              : false,
            h('span', { className: 'renault-wire-time' }, formatTime(item.pubDate)),
          ),
          h('a', {
            className: 'renault-wire-title',
            href: sanitizeUrl(item.link),
            target: '_blank',
            rel: 'noopener',
          }, item.title),
        ),
      );
    }

    replaceChildren(this.content, ...children);
  }
}
