import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import { getThreatColor } from '@/services/threat-classifier';
import { h, replaceChildren } from '@/utils/dom-utils';

export class WeakSignalsPanel extends Panel {
  constructor() {
    super({ id: 'weak-signals', title: 'Weak Signals' });
  }

  update(snapshot: BrandwatchSnapshot): void {
    if (snapshot.weakSignals.length === 0) {
      this.setContent('<div class="empty-state">No emerging weak signal detected in the current corpus.</div>');
      return;
    }

    replaceChildren(
      this.content,
      ...snapshot.weakSignals.map((signal) => (
        h('div', {
          className: 'item',
          style: `border-left: 3px solid ${getThreatColor(signal.severity)}; padding-left: 10px; margin-bottom: 12px;`,
        },
        h('div', { style: 'display:flex; justify-content:space-between; gap:8px; align-items:flex-start;' },
          h('strong', null, signal.label),
          h('span', {
            style: `font-size:10px; color:${getThreatColor(signal.severity)}; text-transform:uppercase;`,
          }, signal.severity),
        ),
        h('div', { className: 'item-source' }, `${signal.recentCount} recent vs ${signal.previousCount} prior window`),
        h('div', { style: 'font-size:11px; color:var(--text-dim); margin-top:4px;' }, signal.sampleTitle),
        signal.entityNames.length > 0
          ? h('div', { style: 'font-size:10px; color:var(--text-muted); margin-top:6px;' }, signal.entityNames.join(' · '))
          : false,
        ))
      ),
    );
  }
}
