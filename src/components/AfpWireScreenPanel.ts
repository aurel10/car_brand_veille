import { Panel } from './Panel';
import { formatTime } from '@/utils';
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

const CATEGORY_LABEL: Record<string, string> = {
  labor: 'Social / RH',
  financial: 'Financier',
  legal: 'Juridique',
  product: 'Produit',
  geopolitical: 'Géopolitique',
  sentiment: 'Opinion',
};

// Brand terms to highlight in article body (yellow)
const HIGHLIGHT_TERMS = [
  'Renault Group', 'Renault SA', 'Renault',
  'Luca de Meo',
  'Dacia',
  'Alpine',
  'Nissan', // Renault-Nissan alliance
  'Ampere', // Renault EV subsidiary
];

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatFullDate(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape HTML, then wrap brand mentions in a highlight span.
 * Longer terms are matched first to avoid partial overlap (e.g. "Renault Group" before "Renault").
 */
function highlightBrands(text: string): string {
  const escaped = escHtml(text);
  // Build a regex alternation sorted by length desc (longest match first)
  const sorted = [...HIGHLIGHT_TERMS].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(t => escHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  return escaped.replace(re, '<mark class="afp-brand-mark">$1</mark>');
}

/**
 * Split plain body text into paragraphs and render as HTML with brand highlighting.
 */
function bodyToHtml(body: string): string {
  if (!body.trim()) return '';
  return body
    .split(/\n{2,}|\n(?=\S)/) // split on blank lines or newline before non-whitespace
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 14px; line-height:1.7;">${highlightBrands(p)}</p>`)
    .join('');
}

export class AfpWireScreenPanel extends Panel {
  private articles: AfpWireArticle[] = [];
  private readerOverlay: HTMLElement | null = null;

  constructor() {
    super({
      id: 'afp-wire-screen',
      title: 'AFP Wire',
      showCount: true,
      className: 'renault-chronology-panel',
    });
    this._buildReaderOverlay();
    this._injectStyles();
  }

  private _injectStyles(): void {
    if (document.getElementById('afp-reader-styles')) return;
    const style = document.createElement('style');
    style.id = 'afp-reader-styles';
    style.textContent = `
      .afp-brand-mark {
        background: transparent;
        color: #ffcc00;
        font-weight: 700;
      }
      .afp-reader-overlay { scrollbar-width: thin; scrollbar-color: #333 #0d0d0d; }
      .afp-reader-overlay *::-webkit-scrollbar { width: 6px; }
      .afp-reader-overlay *::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
    `;
    document.head.appendChild(style);
  }

  private _buildReaderOverlay(): void {
    this.readerOverlay = document.createElement('div');
    this.readerOverlay.className = 'afp-reader-overlay';
    this.readerOverlay.style.cssText = `
      display:none; position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,0.85); backdrop-filter:blur(6px);
      align-items:center; justify-content:center; padding:24px;
    `;
    this.readerOverlay.addEventListener('click', (e) => {
      if (e.target === this.readerOverlay) this._closeReader();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.readerOverlay?.style.display === 'flex') {
        this._closeReader();
      }
    });
    document.body.appendChild(this.readerOverlay);
  }

  private async _openReader(article: AfpWireArticle): Promise<void> {
    if (!this.readerOverlay) return;

    const urgency = article.urgency || 4;
    const urgLabel = URGENCY_LABEL[urgency] ?? 'LEAD';
    const urgColor = URGENCY_COLOR[urgency] ?? '#6b7280';
    const catColor = CATEGORY_COLOR[article.category] ?? '#666';
    const catLabel = CATEGORY_LABEL[article.category] ?? article.category;
    const pubDate = new Date(article.date);

    const isApiUrl = article.url?.includes('afp-apicore') || article.url?.includes('/objects/api/');
    const externalHref = isApiUrl ? null : (article.url || null);
    const iptcList = (article.iptcCodes || []).slice(0, 6);

    // Show immediately with what we have, then populate body
    const bodyPlaceholder = article.body
      ? bodyToHtml(article.body)
      : article.abstract
        ? `<p style="margin:0 0 14px; line-height:1.7; color:#a0a0a0; font-style:italic;">
            ${highlightBrands(article.abstract)}
            ${article.afpId ? '<span id="afp-body-loading" style="display:inline-block; margin-left:8px; color:#555; font-style:normal; font-size:12px;">Chargement du texte intégral…</span>' : ''}
           </p>`
        : `<div id="afp-body-loading" style="color:#555; font-size:13px;">Chargement du texte intégral…</div>`;

    this.readerOverlay.innerHTML = `
      <div class="afp-reader" style="
        background:#0d0d0d; border:1px solid #252525; border-radius:8px;
        max-width:760px; width:100%; max-height:90vh;
        display:flex; flex-direction:column; overflow:hidden;
      ">
        <!-- Sticky header -->
        <div style="
          display:flex; align-items:center; gap:10px; flex-wrap:wrap;
          padding:16px 20px; border-bottom:1px solid #252525;
          position:sticky; top:0; background:#0d0d0d; z-index:1; flex-shrink:0;
        ">
          <span style="font-size:20px; font-weight:900; color:#003399; letter-spacing:-0.5px;">AFP</span>
          <span style="font-size:11px; color:#5a7ab5; flex-grow:1;">Agence France-Presse</span>
          <span style="
            padding:3px 8px; border-radius:3px; font-size:10px; font-weight:700; letter-spacing:0.5px;
            background:${urgColor}20; color:${urgColor}; border:1px solid ${urgColor}50;
          ">${urgLabel}</span>
          <span style="
            padding:3px 8px; border-radius:3px; font-size:10px; font-weight:600;
            background:${catColor}20; color:${catColor}; border:1px solid ${catColor}50;
          ">${catLabel}</span>
          <button class="afp-reader-close" style="
            background:none; border:none; color:#666; font-size:22px; cursor:pointer;
            padding:0 4px; line-height:1; flex-shrink:0; transition:color 0.1s;
          " aria-label="Fermer">×</button>
        </div>

        <!-- Scrollable body -->
        <div style="overflow-y:auto; flex:1; padding:28px 32px; scrollbar-width:thin; scrollbar-color:#333 #0d0d0d;">
          <!-- Dateline -->
          <div style="font-size:11px; color:#555; margin-bottom:18px; display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
            <span>${formatFullDate(pubDate)}</span>
            ${article.language ? `<span style="padding:1px 7px; background:#1a1a1a; border-radius:2px; font-size:10px; color:#666;">${article.language.toUpperCase()}</span>` : ''}
            ${article.country ? `<span style="color:#555;">${escHtml(article.country)}</span>` : ''}
          </div>

          <!-- Headline -->
          <h1 style="
            font-size:24px; font-weight:700; line-height:1.3; color:#f0f0f0;
            margin:0 0 24px; letter-spacing:-0.4px;
          ">${highlightBrands(article.title)}</h1>

          <!-- Body content -->
          <div id="afp-article-body" style="font-size:15px; color:#c0c0c0;">
            ${bodyPlaceholder}
          </div>

          <!-- IPTC tags -->
          ${iptcList.length > 0 ? `
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:24px; padding-top:18px; border-top:1px solid #1e1e1e;">
              ${iptcList.map(code => `
                <span style="padding:2px 9px; border-radius:12px; font-size:10px; background:#1a1a1a; color:#666; border:1px solid #282828;">${escHtml(String(code))}</span>
              `).join('')}
            </div>
          ` : ''}

          <!-- AFP ID -->
          <div style="font-size:10px; color:#383838; margin-top:12px;">
            Dépêche AFP&nbsp;: <code style="color:#444;">${escHtml(article.afpId || '—')}</code>
          </div>
        </div>

        <!-- Footer -->
        <div style="
          padding:14px 20px; border-top:1px solid #1e1e1e; flex-shrink:0;
          display:flex; align-items:center; justify-content:flex-end; gap:10px;
          background:#0a0a0a;
        ">
          ${externalHref ? `
            <a href="${externalHref}" target="_blank" rel="noopener" style="
              padding:8px 18px; border-radius:5px; font-size:12px; font-weight:600;
              background:#003399; color:#fff; text-decoration:none;
            ">Voir sur AFP ↗</a>
          ` : ''}
          <button class="afp-reader-close" style="
            padding:8px 18px; border-radius:5px; font-size:12px;
            background:#1a1a1a; color:#999; border:1px solid #2e2e2e; cursor:pointer;
          ">Fermer</button>
        </div>
      </div>
    `;

    this.readerOverlay.querySelectorAll('.afp-reader-close').forEach(btn => {
      btn.addEventListener('click', () => this._closeReader());
    });

    this.readerOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Fetch full body if not already in stored data
    if (!article.body && article.afpId) {
      this._fetchAndPopulateBody(article.afpId);
    }
  }

  private async _fetchAndPopulateBody(afpId: string): Promise<void> {
    try {
      const resp = await fetch(`/api/afp-article?uno=${encodeURIComponent(afpId)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return;
      const data = await resp.json() as { body?: string; title?: string };
      const bodyEl = this.readerOverlay?.querySelector('#afp-article-body');
      if (!bodyEl || !this.readerOverlay || this.readerOverlay.style.display === 'none') return;

      const bodyHtml = bodyToHtml(data.body || '');
      if (bodyHtml) {
        bodyEl.innerHTML = bodyHtml;
      } else {
        // Remove the loading indicator if no body returned
        const loadingEl = bodyEl.querySelector('#afp-body-loading');
        if (loadingEl) loadingEl.remove();
      }
    } catch {
      const bodyEl = this.readerOverlay?.querySelector('#afp-body-loading');
      if (bodyEl) bodyEl.remove();
    }
  }

  private _closeReader(): void {
    if (!this.readerOverlay) return;
    this.readerOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  update(articles: AfpWireArticle[]): void {
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

    const children: Array<HTMLElement> = [
      h('div', { className: 'renault-wire-summary' },
        h('strong', null, `${this.articles.length} dispatches`),
        h('span', null, 'Most recent first'),
        h('span', null, 'Cliquer pour lire'),
      ),
    ];

    let currentDay = '';
    for (let i = 0; i < this.articles.length; i++) {
      const article = this.articles[i]!;
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
      const urgLabel = URGENCY_LABEL[urgency] ?? 'LEAD';
      const urgColor = URGENCY_COLOR[urgency] ?? '#6b7280';
      const catColor = CATEGORY_COLOR[article.category] ?? '#666';

      const articleEl = h('article', { className: 'renault-wire-item', style: 'cursor:pointer;' },
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
              }, (CATEGORY_LABEL[article.category] ?? article.category).replace(/_/g, ' '))
            : false,
          article.language
            ? h('span', { className: 'renault-wire-chip' }, article.language.toUpperCase())
            : false,
          article.country
            ? h('span', { className: 'renault-wire-chip' }, article.country)
            : false,
          h('span', { className: 'renault-wire-time' }, formatTime(pubDate)),
        ),
        h('div', {
          className: 'renault-wire-title',
          style: 'cursor:pointer;',
        }, article.title),
        article.abstract
          ? h('div', {
              style: 'font-size:12px; color:var(--text-dim); margin-top:3px; line-height:1.4;',
            }, article.abstract.slice(0, 200) + (article.abstract.length > 200 ? '…' : ''))
          : false,
      );

      const idx = i;
      articleEl.addEventListener('click', () => void this._openReader(this.articles[idx]!));
      children.push(articleEl);
    }

    replaceChildren(this.content, ...children);
  }
}
