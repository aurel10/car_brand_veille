import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import { getThreatFieldById } from '@/services/brandwatch/engine';
import { h, replaceChildren } from '@/utils/dom-utils';

export class ThreatMatrixPanel extends Panel {
  constructor() {
    super({ id: 'threat-matrix', title: 'Threat Matrix' });
  }

  update(snapshot: BrandwatchSnapshot): void {
    if (snapshot.matrixRows.length === 0) {
      this.setContent('<div class="empty-state">No Renault entity and threat overlap detected yet.</div>');
      return;
    }

    replaceChildren(
      this.content,
      h('table', {
        style: 'width:100%; border-collapse:collapse; font-size:11px;',
      },
      h('thead', null,
        h('tr', null,
          h('th', { style: 'text-align:left; padding:4px 0; color:var(--text-dim);' }, 'Entity'),
          h('th', { style: 'text-align:left; padding:4px 0; color:var(--text-dim);' }, 'Top threats'),
          h('th', { style: 'text-align:right; padding:4px 0; color:var(--text-dim);' }, 'Mentions'),
        ),
      ),
      h('tbody', null,
        ...snapshot.matrixRows.slice(0, 10).map((row) => (
          h('tr', null,
            h('td', { style: 'padding:6px 0; vertical-align:top;' }, row.entityName),
            h('td', { style: 'padding:6px 0; color:var(--text-dim); vertical-align:top;' },
              row.hotThreatIds.map((id) => getThreatFieldById(id)?.label ?? id).join(' · '),
            ),
            h('td', { style: 'padding:6px 0; text-align:right; vertical-align:top;' }, String(row.totalMentions)),
          )
        )),
      )),
    );
  }
}
