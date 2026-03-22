import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { RENAULT_TRACKED_ENTITIES } from '@/config/renault-watch';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
const EXECUTIVES = RENAULT_TRACKED_ENTITIES.filter(e => e.type === 'executive');

const NEGATIVE_KEYWORDS = [
  'scandal', 'probe', 'investigation', 'lawsuit', 'fired', 'resign',
  'fraud', 'corruption', 'bribery', 'misconduct', 'arrest', 'indicted',
  'scandale', 'enquête', 'démission', 'fraude',
];

const POSITIVE_KEYWORDS = [
  'appointed', 'promoted', 'award', 'partnership', 'growth', 'success',
  'nommé', 'promu', 'croissance', 'succès', 'partenariat',
];

type Sentiment = 'negative' | 'positive' | 'neutral';

function classifySentiment(title: string): Sentiment {
  const lower = title.toLowerCase();
  if (NEGATIVE_KEYWORDS.some(k => lower.includes(k))) return 'negative';
  if (POSITIVE_KEYWORDS.some(k => lower.includes(k))) return 'positive';
  return 'neutral';
}

const SENTIMENT_COLORS: Record<Sentiment, string> = {
  negative: '#ef4444',
  positive: '#22c55e',
  neutral: 'var(--text-dim)',
};

export class LeadershipPanel extends Panel {
  private newsItems: NewsItem[] = [];
  private activeFilter: string | null = null;

  constructor() {
    super({ id: 'leadership', title: 'Leadership Watch' });
    this.content.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('[data-exec-id]') as HTMLElement | null;
      if (chip) {
        const id = chip.dataset.execId!;
        this.activeFilter = this.activeFilter === id ? null : id;
        this.render();
      }
    });
  }

  renderNews(items: NewsItem[]): void {
    this.newsItems = items;
    this.render();
  }

  private matchItemToExecutives(item: NewsItem): typeof EXECUTIVES {
    const text = [item.title, item.source, item.locationName].filter(Boolean).join(' ').toLowerCase();
    return EXECUTIVES.filter(exec =>
      [exec.name, ...exec.aliases].some(alias => text.includes(alias.toLowerCase()))
    );
  }

  private render(): void {
    // Build exec mention counts
    const execMentions = new Map<string, number>();
    for (const exec of EXECUTIVES) {
      execMentions.set(exec.id, 0);
    }
    for (const item of this.newsItems) {
      for (const exec of this.matchItemToExecutives(item)) {
        execMentions.set(exec.id, (execMentions.get(exec.id) ?? 0) + 1);
      }
    }

    const chips = EXECUTIVES.map(exec => {
      const count = execMentions.get(exec.id) ?? 0;
      const isActive = this.activeFilter === exec.id;
      const lastName = exec.name.split(' ').pop() ?? exec.name;
      return `
        <button data-exec-id="${escapeHtml(exec.id)}" style="
          display:inline-flex; align-items:center; gap:4px;
          padding:3px 8px; border-radius:12px; border:1px solid ${isActive ? '#3b82f6' : 'var(--border-color, #444)'};
          background:${isActive ? '#3b82f620' : 'transparent'}; color:${isActive ? '#3b82f6' : 'var(--text)'};
          font-size:11px; cursor:pointer; white-space:nowrap;
        ">
          ${escapeHtml(lastName)}
          ${count > 0 ? `<span style="font-size:9px; color:var(--text-dim);">${count}</span>` : ''}
        </button>
      `;
    }).join('');

    // Filter items
    let filteredItems = this.newsItems;
    if (this.activeFilter) {
      const exec = EXECUTIVES.find(e => e.id === this.activeFilter);
      if (exec) {
        const searchTerms = [exec.name, ...exec.aliases].map(s => s.toLowerCase());
        filteredItems = this.newsItems.filter(item => {
          const text = [item.title, item.source, item.locationName].filter(Boolean).join(' ').toLowerCase();
          return searchTerms.some(term => text.includes(term));
        });
      }
    }

    const newsHtml = filteredItems.length > 0
      ? filteredItems.slice(0, 15).map(item => {
        const matchedExecs = this.matchItemToExecutives(item);
        const sentiment = classifySentiment(item.title);
        const sentimentColor = SENTIMENT_COLORS[sentiment];

        return `
          <div class="item" style="border-left:3px solid ${sentimentColor}; padding-left:10px; margin-bottom:8px;">
            <div class="item-source">
              ${escapeHtml(item.source)}
              ${matchedExecs.map(exec => `<span style="font-size:10px; color:#3b82f6; margin-left:4px;">${escapeHtml(exec.name.split(' ').pop() ?? exec.name)}</span>`).join('')}
              ${sentiment !== 'neutral' ? `<span style="font-size:10px; text-transform:uppercase; color:${sentimentColor}; margin-left:4px;">${sentiment}</span>` : ''}
            </div>
            <a class="item-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
            <div class="item-time">${formatTime(item.pubDate)}</div>
          </div>
        `;
      }).join('')
      : '<div class="empty-state">No leadership news available.</div>';

    this.setContent(`
      <div style="display:flex; gap:6px; flex-wrap:wrap; padding:6px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px;">
        ${chips}
      </div>
      ${newsHtml}
    `);
  }
}
