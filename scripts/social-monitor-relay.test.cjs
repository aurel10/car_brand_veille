'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocialMonitorRelay } = require('./social-monitor-relay.cjs');

function withEnv(nextEnv, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(nextEnv)) {
    previous[key] = process.env[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test('social relay marks YouTube and X as disabled when credentials are missing', async () => {
  await withEnv({
    YOUTUBE_API_KEY: null,
    X_BEARER_TOKEN: null,
  }, async () => {
    const relay = createSocialMonitorRelay({
      enableBluesky: false,
      enableMastodon: false,
      enableReddit: false,
      enableYouTube: true,
      enableX: true,
    });
    const status = relay.getStatus();
    relay.stop();

    assert.equal(status.statuses.find((entry) => entry.platform === 'youtube')?.state, 'disabled');
    assert.equal(status.statuses.find((entry) => entry.platform === 'x')?.state, 'disabled');
  });
});

test('social relay degrades Mastodon per instance instead of failing globally', async () => {
  await withEnv({
    SOCIAL_MASTODON_INSTANCES: 'good.instance,bad.instance',
    SOCIAL_MASTODON_TAGS: 'renault,dacia',
  }, async () => {
    const relay = createSocialMonitorRelay({
      enableBluesky: false,
      enableMastodon: true,
      enableReddit: false,
      enableYouTube: false,
      enableX: false,
      fetchJson: async (url) => {
        if (String(url).includes('good.instance')) return [];
        if (String(url).includes('bad.instance')) throw new Error('Instance unavailable');
        return [];
      },
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const status = relay.getStatus();
    relay.stop();

    const mastodon = status.statuses.find((entry) => entry.platform === 'mastodon');
    assert.equal(mastodon?.state, 'degraded');
    assert.match(String(mastodon?.detail || ''), /1\/2 instances healthy/);
  });
});
