import { Panel } from './Panel';
import type { SocialMonitorView } from '@/services/social-monitor';
import type { SocialEngagementMetrics, SocialPlatform } from '@/types';
import { formatTime } from '@/utils';
import { sanitizeUrl } from '@/utils/sanitize';
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

function renderMetrics(metrics: SocialEngagementMetrics | undefined): string {
  if (!metrics) return '';
  const parts = [
    metrics.likes ? `${metrics.likes} likes` : '',
    metrics.replies ? `${metrics.replies} replies` : '',
    metrics.reposts ? `${metrics.reposts} reposts` : '',
    metrics.comments ? `${metrics.comments} comments` : '',
    metrics.views ? `${metrics.views} views` : '',
    metrics.score ? `${metrics.score} score` : '',
  ].filter(Boolean);
  return parts.slice(0, 3).join(' · ');
}

export class SocialFeedPanel extends Panel {
  constructor() {
    super({ id: 'social-feed', title: 'Social Feed' });
  }

  update(view: SocialMonitorView): void {
    if (!view.relayAvailable) {
      this.setContent(`<div class="empty-state">${view.error || 'Social relay unavailable. Start the local relay to monitor Renault mentions.'}</div>`);
      return;
    }

    if (view.enabledQueryCount === 0) {
      this.setContent('<div class="empty-state">Enable at least one Renault Boolean query to filter the live social stream.</div>');
      return;
    }

    if (view.matchedPosts.length === 0) {
      this.setContent('<div class="empty-state">No social posts match the active Renault Boolean queries yet.</div>');
      return;
    }

    replaceChildren(
      this.content,
      h('div', { style: 'font-size:12px; margin-bottom:10px; color:var(--text-dim);' },
        h('strong', null, String(view.totalMatchedPosts)),
        ` matched posts from ${view.totalRawPosts} ingested items over the last 24 hours`,
      ),
      ...view.matchedPosts.slice(0, 12).map((post) => h('div', {
        className: 'item',
        style: `border-left:3px solid ${PLATFORM_COLORS[post.platform]}; padding-left:10px; margin-bottom:12px;`,
      },
      h('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:4px;' },
        h('span', {
          style: `font-size:10px; text-transform:uppercase; letter-spacing:0.08em; padding:2px 6px; border-radius:999px; border:1px solid ${PLATFORM_COLORS[post.platform]}; color:${PLATFORM_COLORS[post.platform]};`,
        }, platformLabel(post.platform)),
        h('strong', null, post.authorName),
        post.authorHandle ? h('span', { style: 'font-size:11px; color:var(--text-dim);' }, post.authorHandle) : false,
      ),
      h('a', {
        className: 'item-title',
        href: sanitizeUrl(post.url),
        target: '_blank',
        rel: 'noopener',
      }, post.text || 'Open post'),
      h('div', { className: 'item-source' }, post.matchedQueryNames.join(' · ')),
      h('div', { className: 'item-time' }, `${formatTime(new Date(post.publishedAt))}${renderMetrics(post.engagement) ? ` · ${renderMetrics(post.engagement)}` : ''}`),
      )),
    );
  }
}
