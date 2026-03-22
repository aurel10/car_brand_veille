import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import type { BrandwatchAlert } from '@/types';
import { getThreatColor } from '@/services/threat-classifier';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { h, replaceChildren } from '@/utils/dom-utils';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium';

const FILTERS: { key: SeverityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
];

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export class BrandwatchFeedPanel extends Panel {
  private activeFilter: SeverityFilter = 'all';
  private lastSnapshot: BrandwatchSnapshot | null = null;

  constructor() {
    super({ id: 'brandwatch-feed', title: 'Thematic Alerts' });
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-severity-filter]') as HTMLElement | null;
      if (btn) {
        this.activeFilter = btn.dataset.severityFilter as SeverityFilter;
        if (this.lastSnapshot) this.render(this.lastSnapshot);
      }
    });
  }

  update(snapshot: BrandwatchSnapshot): void {
    this.lastSnapshot = snapshot;
    this.render(snapshot);
  }

  private render(snapshot: BrandwatchSnapshot): void {
    let filtered = snapshot.alerts;
    if (this.activeFilter !== 'all') {
      const minRank = SEVERITY_RANK[this.activeFilter] ?? 0;
      filtered = snapshot.alerts.filter(a => (SEVERITY_RANK[a.severity] ?? 0) >= minRank);
    }

    if (snapshot.alerts.length === 0) {
      this.setContent('<div class="empty-state">No Renault-specific alerts matched the current news set.</div>');
      return;
    }

    const filterBar = this.buildFilterBar(snapshot.alerts);

    if (filtered.length === 0) {
      replaceChildren(
        this.content,
        filterBar,
        h('div', { className: 'empty-state' }, `No ${this.activeFilter} alerts.`),
      );
      return;
    }

    replaceChildren(
      this.content,
      filterBar,
      ...filtered.slice(0, 15).map((alert) => this.renderAlert(alert)),
    );
  }

  private buildFilterBar(alerts: BrandwatchAlert[]): HTMLElement {
    const counts: Record<string, number> = { all: alerts.length, critical: 0, high: 0, medium: 0 };
    for (const a of alerts) {
      if (a.severity === 'critical') counts.critical!++;
      if (a.severity === 'high') counts.high!++;
      if (a.severity === 'medium' || a.severity === 'low' || a.severity === 'info') counts.medium!++;
    }

    return h('div', {
      style: 'display:flex; gap:4px; padding:6px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px;',
    },
      ...FILTERS.map(f =>
        h('button', {
          dataset: { severityFilter: f.key },
          style: `
            padding:3px 8px; border-radius:4px; font-size:10px; cursor:pointer;
            border:1px solid ${this.activeFilter === f.key ? (f.key === 'all' ? '#3b82f6' : getThreatColor(f.key)) : 'var(--border-color, #444)'};
            background:${this.activeFilter === f.key ? (f.key === 'all' ? '#3b82f620' : getThreatColor(f.key) + '20') : 'transparent'};
            color:${this.activeFilter === f.key ? (f.key === 'all' ? '#3b82f6' : getThreatColor(f.key)) : 'var(--text-dim)'};
          `,
        }, `${f.label} ${counts[f.key] ?? 0}`),
      ),
    );
  }

  private renderAlert(alert: BrandwatchAlert): HTMLElement {
    const lead = alert.items[0];
    const onMap = () => {
      if (alert.lat == null || alert.lon == null) return;
      window.dispatchEvent(new CustomEvent('brandwatch-map-focus', {
        detail: { lat: alert.lat, lon: alert.lon },
      }));
    };

    return h('div', {
      className: 'item',
      style: `border-left: 3px solid ${getThreatColor(alert.severity)}; padding-left: 10px; margin-bottom: 12px;`,
    },
    h('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:4px;' },
      h('strong', null, alert.subject),
      h('span', {
        style: `font-size:10px; text-transform:uppercase; color:${getThreatColor(alert.severity)}; letter-spacing:0.08em;`,
      }, alert.severity),
      alert.lat != null && alert.lon != null
        ? h('button', {
          className: 'panel-mini-btn',
          style: 'font-size:10px; padding:2px 6px;',
          onClick: onMap,
        }, 'Show on map')
        : false,
    ),
    h('div', { className: 'item-source' }, alert.summary),
    lead
      ? h('a', {
        className: 'item-title',
        href: sanitizeUrl(lead.link),
        target: '_blank',
        rel: 'noopener',
      }, lead.title)
      : false,
    lead ? h('div', { className: 'item-time' }, formatTime(lead.pubDate)) : false,
    h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;' },
      ...alert.items.slice(1, 3).map((item) => h('a', {
        href: sanitizeUrl(item.link),
        target: '_blank',
        rel: 'noopener',
        style: 'font-size:11px; color:var(--text-dim); text-decoration:none;',
      }, item.title)),
    ));
  }
}
