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
  private sortedCache: AfpWireArticle[] = [];

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

    this.sortedCache = sorted;

    const articlesHtml = sorted.slice(0, 30).map((article, idx) => {
      const catColor = CATEGORY_COLORS[article.category] || '#666';
      return `
        <div class="item afp-panel-item" data-afp-idx="${idx}"
          style="border-left:3px solid ${catColor}40; padding-left:10px; margin-bottom:8px; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:4px; margin-bottom:2px;">
            ${urgencyBadge(article.urgency)}
            ${categoryTag(article.category)}
            ${article.language ? `<span style="font-size:9px; padding:1px 4px; border-radius:2px; background:var(--bg-dim); color:var(--text-dim);">${escapeHtml(article.language.toUpperCase())}</span>` : ''}
          </div>
          <div class="item-title" style="cursor:pointer;">${escapeHtml(article.title)}</div>
          <div class="item-time">${article.date ? formatTime(new Date(article.date)) : ''}</div>
        </div>
      `;
    }).join('');

    this.setContent(`${header}${articlesHtml}`);

    // Delegate click → reader
    this.content.querySelectorAll<HTMLElement>('.afp-panel-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset['afpIdx'] ?? -1);
        const article = this.sortedCache[idx];
        if (article) this._openReader(article);
      });
    });
  }

  private _openReader(article: AfpWireArticle): void {
    const existing = document.getElementById('afp-panel-reader-overlay');
    if (existing) existing.remove();

    const urgency = article.urgency || 4;
    const badge = URGENCY_BADGE[urgency] ?? URGENCY_BADGE[3]!;
    const catColor = CATEGORY_COLORS[article.category] || '#666';
    const pubDate = new Date(article.date);

    const isApiUrl = article.url?.includes('afp-apicore') || article.url?.includes('/objects/api/');
    const externalHref = isApiUrl ? null : (article.url || null);

    const bodyHtml = article.body
      ? _bodyToHtml(article.body)
      : article.abstract
        ? `<p style="margin:0 0 14px; line-height:1.7; color:#a0a0a0;">
            ${_highlightBrands(article.abstract)}
            ${article.afpId ? '<span id="afp-body-loading" style="display:inline-block; margin-left:8px; color:#555; font-size:12px;">Chargement…</span>' : ''}
           </p>`
        : '<p id="afp-body-loading" style="color:#555; font-style:italic;">Chargement du texte intégral…</p>';

    const overlay = document.createElement('div');
    overlay.id = 'afp-panel-reader-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,0.85); backdrop-filter:blur(6px);
      display:flex; align-items:center; justify-content:center; padding:24px;
    `;

    overlay.innerHTML = `
      <div style="
        background:#0d0d0d; border:1px solid #252525; border-radius:8px;
        max-width:720px; width:100%; max-height:88vh;
        display:flex; flex-direction:column; overflow:hidden;
      ">
        <div style="
          display:flex; align-items:center; gap:10px; flex-wrap:wrap;
          padding:14px 18px; border-bottom:1px solid #252525;
          position:sticky; top:0; background:#0d0d0d; flex-shrink:0;
        ">
          <span style="font-size:17px; font-weight:900; color:#003399;">AFP</span>
          <span style="font-size:10px; color:#5a7ab5; flex-grow:1;">Agence France-Presse</span>
          <span style="padding:2px 7px; border-radius:3px; font-size:10px; font-weight:700;
            background:${badge.bg}20; color:${badge.bg}; border:1px solid ${badge.bg}50;">${badge.text}</span>
          <span style="padding:2px 7px; border-radius:3px; font-size:10px;
            background:${catColor}20; color:${catColor}; border:1px solid ${catColor}50;">${article.category || ''}</span>
          <button id="afp-reader-close-btn" style="
            background:none; border:none; color:#666; font-size:22px; cursor:pointer; padding:0 4px;
          ">×</button>
        </div>
        <div style="overflow-y:auto; flex:1; padding:22px 26px; scrollbar-width:thin; scrollbar-color:#333 #0d0d0d;">
          <div style="font-size:10px; color:#555; margin-bottom:14px;">
            ${pubDate.toLocaleString()} ${article.language ? `· ${article.language.toUpperCase()}` : ''} ${article.country ? `· ${article.country}` : ''}
          </div>
          <h2 style="font-size:21px; font-weight:700; line-height:1.3; color:#f0f0f0; margin:0 0 20px;">${_highlightBrands(article.title)}</h2>
          <div id="afp-panel-body" style="font-size:14px; color:#c0c0c0;">${bodyHtml}</div>
        </div>
        <div style="padding:12px 18px; border-top:1px solid #1e1e1e; display:flex; justify-content:flex-end; gap:8px; background:#0a0a0a; flex-shrink:0;">
          ${externalHref ? `<a href="${externalHref}" target="_blank" rel="noopener"
            style="padding:7px 16px; border-radius:4px; font-size:11px; font-weight:600;
              background:#003399; color:#fff; text-decoration:none;">Voir sur AFP ↗</a>` : ''}
          <button id="afp-reader-close-btn2" style="
            padding:7px 16px; border-radius:4px; font-size:11px;
            background:#1a1a1a; color:#aaa; border:1px solid #2e2e2e; cursor:pointer;">Fermer</button>
        </div>
      </div>
    `;

    const close = () => { overlay.remove(); document.body.style.overflow = ''; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#afp-reader-close-btn')?.addEventListener('click', close);
    overlay.querySelector('#afp-reader-close-btn2')?.addEventListener('click', close);
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Fetch full body if needed
    if (!article.body && article.afpId) {
      fetch(`/api/afp-article?uno=${encodeURIComponent(article.afpId)}`, { signal: AbortSignal.timeout(15_000) })
        .then(r => r.json() as Promise<{ body?: string }>)
        .then(data => {
          const bodyEl = document.getElementById('afp-panel-body');
          if (!bodyEl || !document.getElementById('afp-panel-reader-overlay')) return;
          const html = _bodyToHtml(data.body || '');
          if (html) bodyEl.innerHTML = html;
          else { const loading = bodyEl.querySelector('#afp-body-loading'); if (loading) loading.remove(); }
        })
        .catch(() => { const loading = document.getElementById('afp-body-loading'); if (loading) loading.remove(); });
    }
  }
}

const AFP_HIGHLIGHT_TERMS = [
  'Renault Group', 'Renault SA', 'Renault',
  'Luca de Meo', 'Dacia', 'Alpine', 'Nissan', 'Ampere',
];

function _esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _highlightBrands(text: string): string {
  const escaped = _esc(text);
  const sorted = [...AFP_HIGHLIGHT_TERMS].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(t => _esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark style="background:transparent;color:#ffcc00;font-weight:700;">$1</mark>');
}

function _bodyToHtml(body: string): string {
  if (!body.trim()) return '';
  return body
    .split(/\n{2,}|\n(?=\S)/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 14px; line-height:1.7;">${_highlightBrands(p)}</p>`)
    .join('');
}
