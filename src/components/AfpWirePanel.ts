import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type { AfpArticle } from '@/services/afp-wire';

/** AFP article with category info attached by the data loader. */
export interface AfpWireArticle extends AfpArticle {
  category: string;
}

const URGENCY_BADGE: Record<number, { text: string; bg: string; fg: string }> = {
  1: { text: 'FLASH', bg: '#ef4444', fg: '#fff' },
  2: { text: 'ALERT', bg: '#f97316', fg: '#fff' },
  3: { text: 'URGENT', bg: '#3b82f6', fg: '#fff' },
  4: { text: 'LEAD', bg: '#6b7280', fg: '#fff' },
};

const CATEGORY_COLORS: Record<string, string> = {
  labor: '#ef4444',
  financial: '#f59e0b',
  legal: '#8b5cf6',
  product: '#ec4899',
  geopolitical: '#06b6d4',
  sentiment: '#10b981',
};

function urgencyBadge(urgency: number): string {
  const badge = URGENCY_BADGE[urgency] ?? URGENCY_BADGE[3]!;
  return `<span style="
    display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:700;
    background:${badge.bg}; color:${badge.fg}; letter-spacing:0.5px;
  ">${badge.text}</span>`;
}

function categoryTag(category: string): string {
  const color = CATEGORY_COLORS[category] || 'var(--text-dim)';
  return `<span style="
    display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px;
    background:${color}20; color:${color}; border:1px solid ${color}40;
  ">${escapeHtml(category)}</span>`;
}

export class AfpWirePanel extends Panel {
  private articles: AfpWireArticle[] = [];

  constructor() {
    super({ id: 'afp-wire', title: 'AFP Wire' });
  }

  renderAfpArticles(articles: AfpWireArticle[]): void {
    this.articles = articles;
    this.render();
  }

  /** Also accept NewsItem[] via the standard renderNews interface for category routing. */
  renderNews(items: NewsItem[]): void {
    // NewsItems don't have AFP-specific fields, render as simple news
    const header = `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px; font-size:11px;">
        <span style="font-weight:700; color:#003399;">AFP</span>
        <span style="color:var(--text); font-weight:600;">Agence France-Presse</span>
        <span style="color:var(--text-dim); margin-left:auto;">${items.length} articles</span>
      </div>
    `;

    const newsHtml = items.length > 0
      ? items.slice(0, 30).map(item => `
          <div class="item" style="border-left:3px solid #00339940; padding-left:10px; margin-bottom:8px;">
            <div class="item-source" style="font-size:10px; color:var(--text-dim);">
              AFP
              ${item.lang ? `<span class="lang-badge">${item.lang.toUpperCase()}</span>` : ''}
            </div>
            <a class="item-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
            <div class="item-time">${formatTime(item.pubDate)}</div>
          </div>
        `).join('')
      : '<div class="empty-state">No AFP wire articles available.</div>';

    this.setContent(`${header}${newsHtml}`);
  }

  private render(): void {
    if (this.articles.length === 0) {
      this.setContent('<div class="empty-state">No AFP wire articles available.</div>');
      return;
    }

    // Sort by urgency (flash first), then by date (newest first)
    const sorted = [...this.articles].sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency - b.urgency;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    // Count by urgency
    const urgencyCounts = new Map<number, number>();
    for (const a of sorted) {
      urgencyCounts.set(a.urgency, (urgencyCounts.get(a.urgency) ?? 0) + 1);
    }

    const urgencySummary = [...urgencyCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([urg, count]) => `${urgencyBadge(urg)} <span style="font-size:10px; color:var(--text-dim);">${count}</span>`)
      .join(' ');

    // Count by category
    const catCounts = new Map<string, number>();
    for (const a of sorted) {
      catCounts.set(a.category, (catCounts.get(a.category) ?? 0) + 1);
    }

    const catSummary = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${categoryTag(cat)} <span style="font-size:10px; color:var(--text-dim);">${count}</span>`)
      .join(' ');

    const header = `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px; font-size:11px;">
        <span style="font-weight:700; color:#003399;">AFP</span>
        <span style="color:var(--text); font-weight:600;">Agence France-Presse</span>
        <span style="color:var(--text-dim); margin-left:auto;">${sorted.length} dispatches</span>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">${urgencySummary}</div>
      <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:10px;">${catSummary}</div>
    `;

    const articlesHtml = sorted.slice(0, 30).map(article => {
      const catColor = CATEGORY_COLORS[article.category] || '#666';
      return `
        <div class="item" style="border-left:3px solid ${catColor}40; padding-left:10px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:4px; margin-bottom:2px;">
            ${urgencyBadge(article.urgency)}
            ${categoryTag(article.category)}
            ${article.language ? `<span style="font-size:9px; padding:1px 4px; border-radius:2px; background:var(--bg-dim); color:var(--text-dim);">${escapeHtml(article.language.toUpperCase())}</span>` : ''}
          </div>
          <a class="item-title" href="${sanitizeUrl(article.url || '#')}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
          <div class="item-time">${article.date ? formatTime(new Date(article.date)) : ''}</div>
        </div>
      `;
    }).join('');

    this.setContent(`${header}${articlesHtml}`);
  }
}
