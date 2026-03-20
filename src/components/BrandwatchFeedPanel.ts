import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import { getThreatColor } from '@/services/threat-classifier';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
import { h, replaceChildren } from '@/utils/dom-utils';

export class BrandwatchFeedPanel extends Panel {
  constructor() {
    super({ id: 'brandwatch-feed', title: 'Thematic Alerts' });
  }

  update(snapshot: BrandwatchSnapshot): void {
    if (snapshot.alerts.length === 0) {
      this.setContent('<div class="empty-state">No Renault-specific alerts matched the current news set.</div>');
      return;
    }

    replaceChildren(
      this.content,
      ...snapshot.alerts.slice(0, 10).map((alert) => {
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
      }),
    );
  }
}
