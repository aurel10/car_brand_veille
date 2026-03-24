import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isGoogleNewsFeedUrl,
  normalizeFeedItemMetadata,
  resolveOriginalFeedUrl,
} from '../src/services/rss-source.ts';

describe('resolveOriginalFeedUrl', () => {
  it('unwraps rss proxy URLs to the original target', () => {
    const resolved = resolveOriginalFeedUrl('/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Drenault');
    assert.equal(resolved, 'https://news.google.com/rss/search?q=renault');
  });
});

describe('isGoogleNewsFeedUrl', () => {
  it('detects proxied Google News feeds', () => {
    assert.equal(
      isGoogleNewsFeedUrl('/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Drenault'),
      true,
    );
  });

  it('ignores non-Google RSS feeds', () => {
    assert.equal(isGoogleNewsFeedUrl('https://www.lemonde.fr/rss/une.xml'), false);
  });
});

describe('normalizeFeedItemMetadata', () => {
  it('replaces Google News feed labels with the real publisher and trims duplicate title suffixes', () => {
    const normalized = normalizeFeedItemMetadata({
      feedName: 'Google News France',
      feedUrl: '/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Drenault',
      title: 'Renault présente ses ambitions électriques avec le projet « futurReady » - Les Echos',
      link: 'https://news.google.com/rss/articles/example',
      sourceText: 'Les Echos',
      sourceUrl: 'https://www.lesechos.fr',
      description: '<font color="#6f6f6f">Les Echos</font>',
    });

    assert.equal(normalized.source, 'Les Echos');
    assert.equal(normalized.title, 'Renault présente ses ambitions électriques avec le projet « futurReady »');
  });

  it('falls back to a title-derived publisher for Google News items when the source tag is missing', () => {
    const normalized = normalizeFeedItemMetadata({
      feedName: 'Google News Factories',
      feedUrl: '/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dfactory',
      title: 'Renault Korea expands EV production capacity at Busan plant - The Korea Herald',
      link: 'https://news.google.com/rss/articles/example',
    });

    assert.equal(normalized.source, 'The Korea Herald');
    assert.equal(normalized.title, 'Renault Korea expands EV production capacity at Busan plant');
  });

  it('drops Google News items when no real publisher can be inferred', () => {
    const normalized = normalizeFeedItemMetadata({
      feedName: 'Google News Supply Chain',
      feedUrl: '/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3Dsupply',
      title: 'Renault supplier watch',
      link: 'https://news.google.com/rss/articles/example',
    });

    assert.equal(normalized.source, null);
    assert.equal(normalized.title, 'Renault supplier watch');
  });

  it('keeps direct RSS feed labels untouched', () => {
    const normalized = normalizeFeedItemMetadata({
      feedName: 'Le Figaro Auto',
      feedUrl: 'https://www.lefigaro.fr/rss/figaro_auto.xml',
      title: 'La nouvelle Renault Twingo arrive en concession',
      link: 'https://www.lefigaro.fr/auto/article',
      sourceText: 'Google News',
    });

    assert.equal(normalized.source, 'Le Figaro Auto');
    assert.equal(normalized.title, 'La nouvelle Renault Twingo arrive en concession');
  });
});
