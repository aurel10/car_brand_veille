import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import { h, replaceChildren } from '@/utils/dom-utils';

function buildBars(points: BrandwatchSnapshot['trendPoints']): string {
  if (points.length === 0) return '';
  const totals = new Map<string, number>();
  for (const point of points) {
    totals.set(point.bucket, (totals.get(point.bucket) ?? 0) + point.count);
  }
  const ordered = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  const max = Math.max(...ordered.map(([, count]) => count), 1);

  return ordered.map(([bucket, count]) => {
    const height = Math.max(8, Math.round((count / max) * 64));
    return `
      <div style="display:flex; flex-direction:column; align-items:center; gap:6px; flex:1;">
        <div style="width:100%; max-width:28px; height:72px; display:flex; align-items:flex-end;">
          <div style="width:100%; border-radius:8px 8px 2px 2px; background:linear-gradient(180deg, #f97316 0%, #ef4444 100%); height:${height}px;"></div>
        </div>
        <div style="font-size:10px; color:var(--text-dim);">${bucket.slice(5)}</div>
      </div>
    `;
  }).join('');
}

export class MentionTrendsPanel extends Panel {
  constructor() {
    super({ id: 'mention-trends', title: 'Mention Trends' });
  }

  update(snapshot: BrandwatchSnapshot): void {
    if (snapshot.trendPoints.length === 0) {
      this.setContent('<div class="empty-state">Mention trends will appear once Renault query hits accumulate.</div>');
      return;
    }

    const totalMentions = snapshot.trendPoints.reduce((sum, point) => sum + point.count, 0);
    replaceChildren(
      this.content,
      h('div', { style: 'font-size:12px; margin-bottom:10px;' },
        h('strong', null, String(totalMentions)),
        ' mentions over the last 7 days',
      ),
      h('div', {
        style: 'display:flex; gap:10px; align-items:flex-end; min-height:120px;',
      }),
    );

    const chart = this.content.lastElementChild as HTMLElement | null;
    if (chart) chart.innerHTML = buildBars(snapshot.trendPoints);
  }
}
