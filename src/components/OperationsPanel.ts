import { Panel } from './Panel';
import type { NewsItem } from '@/types';
import { RENAULT_SITES, RENAULT_TRACKED_ENTITIES } from '@/config/renault-watch';
import { formatTime } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

type SiteStatus = 'normal' | 'watch' | 'alert';

interface SiteState {
  name: string;
  city: string;
  country: string;
  status: SiteStatus;
  matchCount: number;
}

const ALERT_KEYWORDS = [
  'strike', 'fire', 'explosion', 'shutdown', 'halt', 'closure',
  'grève', 'incendie', 'arrêt', 'fermeture', 'accident',
  'blocked', 'evacuated', 'suspended', 'outage',
];

const WATCH_KEYWORDS = [
  'disruption', 'delay', 'shortage', 'warning', 'protest',
  'perturbation', 'retard', 'pénurie', 'manifestation',
  'maintenance', 'inspection', 'audit', 'investigation',
];

function classifySiteStatus(matchingItems: NewsItem[]): SiteStatus {
  for (const item of matchingItems) {
    const text = item.title.toLowerCase();
    if (ALERT_KEYWORDS.some(k => text.includes(k))) return 'alert';
  }
  for (const item of matchingItems) {
    const text = item.title.toLowerCase();
    if (WATCH_KEYWORDS.some(k => text.includes(k))) return 'watch';
  }
  return matchingItems.length > 0 ? 'watch' : 'normal';
}

const STATUS_COLORS: Record<SiteStatus, string> = {
  normal: '#22c55e',
  watch: '#eab308',
  alert: '#ef4444',
};

const FACTORY_SITES = RENAULT_SITES.filter(s => s.type === 'factory');
const FACTORY_ENTITIES = RENAULT_TRACKED_ENTITIES.filter(e => e.type === 'factory');

export class OperationsPanel extends Panel {
  private newsItems: NewsItem[] = [];

  constructor() {
    super({ id: 'operations', title: 'Operations & Plants' });
  }

  renderNews(items: NewsItem[]): void {
    this.newsItems = items;
    this.render();
  }

  private matchItemsToSite(site: typeof FACTORY_SITES[0]): NewsItem[] {
    const entity = FACTORY_ENTITIES.find(e => e.id === site.entityId);
    if (!entity) return [];
    const searchTerms = [entity.name, ...entity.aliases].map(s => s.toLowerCase());
    return this.newsItems.filter(item => {
      const text = [item.title, item.source, item.locationName].filter(Boolean).join(' ').toLowerCase();
      return searchTerms.some(term => text.includes(term));
    });
  }

  private render(): void {
    const siteStates: SiteState[] = FACTORY_SITES.map(site => {
      const matchingItems = this.matchItemsToSite(site);
      return {
        name: site.name,
        city: site.city,
        country: site.country,
        status: classifySiteStatus(matchingItems),
        matchCount: matchingItems.length,
      };
    });

    const alertCount = siteStates.filter(s => s.status === 'alert').length;
    const watchCount = siteStates.filter(s => s.status === 'watch').length;
    const normalCount = siteStates.filter(s => s.status === 'normal').length;

    const statusSummary = `
      <div style="display:flex; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px; font-size:11px;">
        <span style="color:${STATUS_COLORS.alert};">● ${alertCount} Alert</span>
        <span style="color:${STATUS_COLORS.watch};">● ${watchCount} Watch</span>
        <span style="color:${STATUS_COLORS.normal};">● ${normalCount} Normal</span>
        <span style="color:var(--text-dim); margin-left:auto;">${FACTORY_SITES.length} sites</span>
      </div>
    `;

    const siteGrid = siteStates
      .sort((a, b) => {
        const order: Record<SiteStatus, number> = { alert: 0, watch: 1, normal: 2 };
        return order[a.status] - order[b.status];
      })
      .map(site => `
        <div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:11px;">
          <span style="color:${STATUS_COLORS[site.status]}; font-size:8px;">●</span>
          <span style="min-width:140px; color:var(--text);">${escapeHtml(site.name)}</span>
          <span style="color:var(--text-dim); font-size:10px;">${escapeHtml(site.country)}</span>
          ${site.matchCount > 0 ? `<span style="margin-left:auto; font-size:10px; color:var(--text-dim);">${site.matchCount} mention${site.matchCount > 1 ? 's' : ''}</span>` : ''}
        </div>
      `)
      .join('');

    const newsHtml = this.newsItems.length > 0
      ? this.newsItems.slice(0, 15).map(item => {
        const matchedSite = FACTORY_SITES.find(site => {
          const entity = FACTORY_ENTITIES.find(e => e.id === site.entityId);
          if (!entity) return false;
          const text = [item.title, item.source, item.locationName].filter(Boolean).join(' ').toLowerCase();
          return [entity.name, ...entity.aliases].some(term => text.includes(term.toLowerCase()));
        });

        return `
          <div class="item" style="border-left:3px solid ${matchedSite ? STATUS_COLORS.watch : 'transparent'}; padding-left:10px; margin-bottom:8px;">
            <div class="item-source">
              ${escapeHtml(item.source)}
              ${matchedSite ? `<span style="font-size:10px; color:${STATUS_COLORS.watch}; margin-left:4px;">📍 ${escapeHtml(matchedSite.name)}</span>` : ''}
            </div>
            <a class="item-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
            <div class="item-time">${formatTime(item.pubDate)}</div>
          </div>
        `;
      }).join('')
      : '<div class="empty-state">No operations news available.</div>';

    this.setContent(`
      ${statusSummary}
      <div style="max-height:180px; overflow-y:auto; margin-bottom:10px; border-bottom:1px solid var(--border-color, #333); padding-bottom:8px;">
        ${siteGrid}
      </div>
      ${newsHtml}
    `);
  }
}
