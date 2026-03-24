import { Panel } from './Panel';
import type { SocialMonitorView } from '@/services/social-monitor';
import type { SocialConnectorStatus, SocialPlatform } from '@/types';
import { formatTime } from '@/utils';
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

function statusColor(status: SocialConnectorStatus['state']): string {
  if (status === 'connected' || status === 'polling') return '#22c55e';
  if (status === 'degraded') return '#f59e0b';
  if (status === 'disabled') return '#64748b';
  return '#ef4444';
}

export class SocialAuthorsPanel extends Panel {
  constructor() {
    super({ id: 'social-authors', title: 'Social Authors & Platforms' });
  }

  update(view: SocialMonitorView): void {
    if (!view.relayAvailable) {
      this.setContent(`<div class="empty-state">${view.error || 'Social relay unavailable.'}</div>`);
      return;
    }

    replaceChildren(
      this.content,
      h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;' },
        ...view.statuses.map((status) => h('span', {
          style: `font-size:10px; padding:2px 6px; border-radius:999px; border:1px solid ${statusColor(status.state)}; color:${statusColor(status.state)};`,
          title: status.lastError || status.detail || '',
        }, `${platformLabel(status.platform)} ${status.state}`)),
      ),
      view.updatedAt
        ? h('div', { style: 'font-size:11px; color:var(--text-dim); margin-bottom:10px;' }, `Updated ${formatTime(new Date(view.updatedAt))}`)
        : false,
      h('div', { style: 'font-size:11px; color:var(--text-dim); margin-bottom:10px;' }, `${view.totalRawPosts} ingested posts in rolling 24h buffer`),
      view.topAuthors.length === 0
        ? h('div', { className: 'empty-state' }, view.enabledQueryCount === 0 ? 'Enable a Renault Boolean query to rank social authors.' : 'Top authors will appear once the stream matches your queries.')
        : h('div', null,
          ...view.topAuthors.map((author) => h('div', {
            className: 'item',
            style: 'margin-bottom:10px;',
          },
          h('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' },
            h('strong', null, author.label),
            author.handle ? h('span', { style: 'font-size:11px; color:var(--text-dim);' }, author.handle) : false,
            h('span', { style: 'font-size:10px; color:var(--text-dim);' }, `${author.count} posts`),
          ),
          h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;' },
            ...author.platforms.map((platform) => h('span', {
              style: `font-size:10px; color:${PLATFORM_COLORS[platform]}; border:1px solid ${PLATFORM_COLORS[platform]}; border-radius:999px; padding:1px 6px;`,
            }, platformLabel(platform))),
          ),
          h('div', { className: 'item-time' }, `Latest match ${formatTime(new Date(author.latestAt))}`),
          )),
        ),
    );
  }
}
