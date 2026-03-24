import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BrandwatchQuery, SocialSnapshot } from '../src/types/index.ts';
import { buildSocialMonitorView, dedupeSocialPosts } from '../src/services/social-monitor.ts';

function makeQuery(id: string, query: string, overrides: Partial<BrandwatchQuery> = {}): BrandwatchQuery {
  return {
    id,
    name: id,
    query,
    enabled: true,
    color: '#22c55e',
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('social monitor matching', () => {
  const snapshot: SocialSnapshot = {
    ok: true,
    updatedAt: '2026-03-24T08:00:00.000Z',
    windowHours: 24,
    totalPosts: 3,
    terms: ['renault', 'dacia'],
    statuses: [],
    posts: [
      {
        id: 'bluesky:1',
        platform: 'bluesky',
        nativeId: '1',
        url: 'https://bsky.app/profile/demo/post/1',
        text: 'Renault strike may hit Douai next week',
        authorName: 'Union Watch',
        authorHandle: '@unionwatch',
        hashtags: ['strike', 'renault'],
        publishedAt: '2026-03-24T07:00:00.000Z',
        fetchedAt: '2026-03-24T07:01:00.000Z',
        profileLocation: 'France',
        searchText: 'Renault strike may hit Douai next week #strike #renault Union Watch @unionwatch France',
      },
      {
        id: 'reddit:abc',
        platform: 'reddit',
        nativeId: 'abc',
        url: 'https://reddit.com/r/cars/comments/abc',
        text: 'Battery recall chatter around the new Renault launch',
        authorName: 'cars_mod',
        authorHandle: 'u/cars_mod',
        hashtags: [],
        publishedAt: '2026-03-24T06:30:00.000Z',
        fetchedAt: '2026-03-24T06:31:00.000Z',
        subreddit: 'cars',
      },
      {
        id: 'reddit:abc-dup',
        platform: 'reddit',
        nativeId: 'abc',
        url: 'https://reddit.com/r/cars/comments/abc',
        text: 'Battery recall chatter around the new Renault launch',
        authorName: 'cars_mod',
        authorHandle: 'u/cars_mod',
        hashtags: [],
        publishedAt: '2026-03-24T06:30:00.000Z',
        fetchedAt: '2026-03-24T06:31:00.000Z',
        subreddit: 'cars',
      },
    ],
  };

  it('dedupes posts by platform and native id/url', () => {
    const deduped = dedupeSocialPosts(snapshot.posts);
    assert.equal(deduped.length, 2);
  });

  it('matches boolean Renault queries against synthetic social fields', () => {
    const queries = [
      makeQuery('factory-social', '(Renault OR Dacia) AND (strike OR walkout)'),
      makeQuery('product-safety', 'Renault AND (recall OR battery)'),
      makeQuery('sql-only', 'SELECT 1 FROM `gdelt-bq.gdeltv2.gkg_partitioned`', { mode: 'sql' }),
    ];

    const view = buildSocialMonitorView(snapshot, queries);

    assert.equal(view.enabledQueryCount, 2);
    assert.equal(view.totalMatchedPosts, 2);
    assert.deepStrictEqual(view.platformCounts, { bluesky: 1, reddit: 1 });
    assert.deepStrictEqual(
      view.matchedPosts.map((post) => post.matchedQueryIds),
      [['factory-social'], ['product-safety']],
    );
    assert.equal(view.topAuthors[0]?.label, 'Union Watch');
  });

  it('uses author and location metadata for fielded social matching', () => {
    const fieldedSnapshot: SocialSnapshot = {
      ...snapshot,
      posts: [
        {
          id: 'mastodon:1',
          platform: 'mastodon',
          nativeId: '1',
          url: 'https://mastodon.social/@union/1',
          text: 'Walkout pressure is building tonight',
          authorName: 'Factory Union',
          authorHandle: '@factoryunion',
          hashtags: ['walkout'],
          publishedAt: '2026-03-24T07:45:00.000Z',
          fetchedAt: '2026-03-24T07:45:20.000Z',
          profileLocation: 'France',
          instance: 'mastodon.social',
        },
      ],
    };

    const view = buildSocialMonitorView(fieldedSnapshot, [
      makeQuery('fielded', 'person:factoryunion AND location:France AND theme:walkout'),
    ]);

    assert.equal(view.totalMatchedPosts, 1);
    assert.deepStrictEqual(view.matchedPosts[0]?.matchedQueryIds, ['fielded']);
  });
});
