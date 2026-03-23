/**
 * Lightweight AFP OAuth helper for seed scripts.
 *
 * AFP uses OAuth 2.0 with grant_type=password:
 *   - Basic Auth header: base64(client_id:client_secret)
 *   - Username + password as form-encoded POST body
 *
 * Tokens are cached in memory with a safety margin to avoid
 * re-authenticating for every query in a multi-query seed run.
 */

const AFP_TOKEN_URL = 'https://afp-apicore-prod.afp.com/oauth/token';

/** @type {{ accessToken: string; expiresAt: number } | null} */
let cached = null;

/**
 * Obtain a valid AFP access token.
 *
 * Reads AFP_CLIENT_ID, AFP_CLIENT_SECRET, AFP_USERNAME, AFP_PASSWORD from env.
 * Returns a cached token if still valid (minus 60s safety margin).
 *
 * @param {object} [options]
 * @param {string} [options.userAgent] - User-Agent header value.
 * @returns {Promise<string|null>}
 */
export async function getAfpToken({ userAgent } = {}) {
  // Return cached token if still valid
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const clientId = (process.env.AFP_CLIENT_ID || '').trim();
  const clientSecret = (process.env.AFP_CLIENT_SECRET || '').trim();
  const username = (process.env.AFP_USERNAME || '').trim();
  const password = (process.env.AFP_PASSWORD || '').trim();

  if (!clientId || !clientSecret || !username || !password) {
    console.warn('  AFP: missing credentials (AFP_CLIENT_ID, AFP_CLIENT_SECRET, AFP_USERNAME, AFP_PASSWORD)');
    return null;
  }

  console.log('  AFP: exchanging credentials for OAuth token...');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
  });

  const headers = {
    Authorization: `Basic ${basicAuth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (userAgent) headers['User-Agent'] = userAgent;

  try {
    const resp = await fetch(AFP_TOKEN_URL, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`  AFP OAuth exchange failed (${resp.status}): ${text.slice(0, 200)}`);
      cached = null;
      return null;
    }

    const data = await resp.json();
    if (data.access_token) {
      const expiresIn = data.expires_in || 3600;
      cached = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (expiresIn * 1000) - 60_000, // 60s safety margin
      };
      console.log(`  AFP: OAuth token obtained (expires in ${expiresIn}s)`);
      return cached.accessToken;
    }

    console.warn('  AFP: OAuth response missing access_token');
    return null;
  } catch (err) {
    console.warn(`  AFP: OAuth exchange error: ${err.message}`);
    cached = null;
    return null;
  }
}

/**
 * Clear the cached token (e.g. after a 401 response).
 */
export function clearAfpTokenCache() {
  cached = null;
}
