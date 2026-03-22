import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

const FRENCH_SOURCES: Record<string, string> = {
  'Le Monde': '#1a1a2e',
  'Le Figaro': '#c0392b',
  'Libération': '#e74c3c',
  'Les Échos': '#2980b9',
  'La Tribune': '#27ae60',
  'BFM Business': '#f39c12',
  'France 24': '#3498db',
  'Reuters FR': '#ff6600',
  'AFP': '#003399',
  'L\'Usine Nouvelle': '#e67e22',
  'Challenges': '#8e44ad',
  'L\'Express': '#d35400',
};

function getSourceColor(source: string): string {
  for (const [name, color] of Object.entries(FRENCH_SOURCES)) {
    if (source.toLowerCase().includes(name.toLowerCase())) return color;
  }
  return 'var(--text-dim)';
}

export class FrenchPressPanel extends Panel {
  private newsItems: NewsItem[] = [];

  constructor() {
    super({ id: 'frenchpress', title: 'French Press' });
  }

  renderNews(items: NewsItem[]): void {
    this.newsItems = items;
    this.render();
  }

  private render(): void {
    const header = `
      <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px; font-size:11px;">
        <span style="font-size:13px;">🇫🇷</span>
        <span style="color:var(--text); font-weight:600;">Presse Française</span>
        <span style="color:var(--text-dim); margin-left:auto;">${this.newsItems.length} articles</span>
      </div>
    `;

    // Group by source
    const sourceCounts = new Map<string, number>();
    for (const item of this.newsItems) {
      sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    }

    const sourceBadges = [...sourceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([source, count]) => `
        <span style="
          display:inline-flex; align-items:center; gap:3px;
          padding:2px 6px; border-radius:3px; font-size:10px;
          background:${getSourceColor(source)}30; color:var(--text-dim);
          border:1px solid ${getSourceColor(source)}40;
        ">
          ${escapeHtml(source)} <span style="opacity:0.7;">${count}</span>
        </span>
      `)
      .join('');

    const newsHtml = this.newsItems.length > 0
      ? this.newsItems.slice(0, 20).map(item => `
          <div class="item" style="border-left:3px solid ${getSourceColor(item.source)}40; padding-left:10px; margin-bottom:8px;">
            <div class="item-source">
              ${escapeHtml(item.source)}
              ${item.lang ? `<span class="lang-badge">${item.lang.toUpperCase()}</span>` : ''}
            </div>
            <a class="item-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
            <div class="item-time">${formatTime(item.pubDate)}</div>
          </div>
        `).join('')
      : '<div class="empty-state">Aucune actualité disponible.</div>';

    this.setContent(`
      ${header}
      <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:10px;">
        ${sourceBadges}
      </div>
      ${newsHtml}
    `);
  }
}
