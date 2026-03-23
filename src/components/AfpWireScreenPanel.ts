import { Panel } from './Panel';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { h, replaceChildren } from '@/utils/dom-utils';
import type { AfpWireArticle } from './AfpWirePanel';

const URGENCY_LABEL: Record<number, string> = {
  1: 'FLASH',
  2: 'ALERT',
  3: 'URGENT',
  4: 'LEAD',
};

const URGENCY_COLOR: Record<number, string> = {
  1: '#ef4444',
  2: '#f97316',
  3: '#3b82f6',
  4: '#6b7280',
};

const CATEGORY_COLOR: Record<string, string> = {
  labor: '#ef4444',
  financial: '#f59e0b',
  legal: '#8b5cf6',
  product: '#ec4899',
  geopolitical: '#06b6d4',
  sentiment: '#10b981',
};

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export class AfpWireScreenPanel extends Panel {
  private articles: AfpWireArticle[] = [];

  constructor() {
    super({
      id: 'afp-wire-screen',
      title: 'AFP Wire',
      showCount: true,
      className: 'renault-chronology-panel',
    });
  }

  update(articles: AfpWireArticle[]): void {
    // Deduplicate by afpId
    const seen = new Set<string>();
    const unique: AfpWireArticle[] = [];
    for (const a of [...articles].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())) {
      const key = a.afpId || `${a.source}::${a.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(a);
    }

    this.articles = unique;
    this.setCount(unique.length);
    this._render();
  }

  private _render(): void {
    if (this.articles.length === 0) {
      this.setContent('<div class="empty-state">No AFP wire articles available.</div>');
      return;
    }

    const sourceCount = new Set(this.articles.map((a) => a.source)).size;
    const children: Array<HTMLElement> = [
      h('div', { className: 'renault-wire-summary' },
        h('strong', null, `${this.articles.length} dispatches`),
        h('span', null, `${sourceCount} source`),
        h('span', null, 'Most recent first'),
      ),
    ];

    let currentDay = '';
    for (const article of this.articles) {
      const pubDate = new Date(article.date);
      const dayLabel = formatDayLabel(pubDate);
      if (dayLabel !== currentDay) {
        currentDay = dayLabel;
        children.push(
          h('div', { className: 'renault-wire-day' },
            h('span', null, dayLabel),
          ),
        );
      }

      const urgency = article.urgency || 4;
      const urgLabel = URGENCY_LABEL[urgency] || 'LEAD';
      const urgColor = URGENCY_COLOR[urgency] || '#6b7280';
      const catColor = CATEGORY_COLOR[article.category] || '#666';

      children.push(
        h('article', { className: 'renault-wire-item' },
          h('div', { className: 'renault-wire-item-meta' },
            h('span', {
              className: 'renault-wire-source',
              style: `color:#003399; font-weight:700;`,
            }, 'AFP'),
            h('span', {
              className: 'renault-wire-chip',
              style: `border-color:${urgColor}; color:${urgColor}; font-weight:700;`,
            }, urgLabel),
            article.category
              ? h('span', {
                  className: 'renault-wire-chip',
                  style: `border-color:${catColor}; color:${catColor};`,
                }, article.category.replace(/_/g, ' '))
              : false,
            article.language
              ? h('span', { className: 'renault-wire-chip' }, article.language.toUpperCase())
              : false,
            article.country
              ? h('span', { className: 'renault-wire-chip' }, article.country)
              : false,
            h('span', { className: 'renault-wire-time' }, formatTime(pubDate)),
          ),
          h('a', {
            className: 'renault-wire-title',
            href: sanitizeUrl(article.url || '#'),
            target: '_blank',
            rel: 'noopener',
          }, article.title),
          article.abstract
            ? h('div', {
                style: 'font-size:12px; color:var(--text-dim); margin-top:3px; line-height:1.4;',
              }, article.abstract.slice(0, 200) + (article.abstract.length > 200 ? '…' : ''))
            : false,
        ),
      );
    }

    replaceChildren(this.content, ...children);
  }
}
