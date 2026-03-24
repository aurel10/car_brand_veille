import { Panel } from './Panel';
import type { SocialMonitorView } from '@/services/social-monitor';
import type { SocialPlatform } from '@/types';
import { h, replaceChildren } from '@/utils/dom-utils';

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  bluesky: '#1d9bf0',
  mastodon: '#6364ff',
  youtube: '#ef4444',
  reddit: '#f97316',
  x: '#94a3b8',
};

function platformLabel(platform: SocialPlatform): string {
  return platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
}

function buildBars(view: SocialMonitorView): string {
  if (view.trendBuckets.length === 0) return '';
  const ordered = view.trendBuckets.slice(-12);
  const max = Math.max(...ordered.map((bucket) => bucket.total), 1);

  return ordered.map((bucket) => {
    const height = Math.max(8, Math.round((bucket.total / max) * 64));
    const label = bucket.bucket.slice(11, 13) + 'h';
    return `
      <div style="display:flex; flex-direction:column; align-items:center; gap:6px; flex:1;">
        <div style="width:100%; max-width:26px; height:72px; display:flex; align-items:flex-end;">
          <div style="width:100%; border-radius:8px 8px 2px 2px; background:linear-gradient(180deg, #1d9bf0 0%, #f97316 100%); height:${height}px;"></div>
        </div>
        <div style="font-size:10px; color:var(--text-dim);">${label}</div>
      </div>
    `;
  }).join('');
}

export class SocialTrendsPanel extends Panel {
  constructor() {
    super({ id: 'social-trends', title: 'Social Trends' });
  }

  update(view: SocialMonitorView): void {
    if (!view.relayAvailable) {
      this.setContent(`<div class="empty-state">${view.error || 'Social relay unavailable.'}</div>`);
      return;
    }

    if (view.enabledQueryCount === 0) {
      this.setContent('<div class="empty-state">Enable a Renault Boolean query to build social mention trends.</div>');
      return;
    }

    if (view.trendBuckets.length === 0) {
      this.setContent('<div class="empty-state">Trend bars will appear once the social stream matches your Renault queries.</div>');
      return;
    }

    replaceChildren(
      this.content,
      h('div', { style: 'font-size:12px; margin-bottom:10px;' },
        h('strong', null, String(view.totalMatchedPosts)),
        ' matched social mentions in the last 24 hours',
      ),
      h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;' },
        ...Object.entries(view.platformCounts)
          .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
          .map(([platform, count]) => h('span', {
            style: `font-size:10px; padding:2px 6px; border-radius:999px; border:1px solid ${PLATFORM_COLORS[platform as SocialPlatform]}; color:${PLATFORM_COLORS[platform as SocialPlatform]};`,
          }, `${platformLabel(platform as SocialPlatform)} ${count}`)),
      ),
      h('div', { style: 'display:flex; gap:10px; align-items:flex-end; min-height:120px;' }),
    );

    const chart = this.content.lastElementChild as HTMLElement | null;
    if (chart) chart.innerHTML = buildBars(view);
  }
}
