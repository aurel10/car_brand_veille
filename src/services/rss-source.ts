function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanPublisherLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  if (/^google\s+(news|actualit(?:e|é)s)$/iu.test(normalized)) return null;
  return normalized;
}

export function resolveOriginalFeedUrl(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl, 'http://localhost');
    const proxiedUrl = parsed.searchParams.get('url');
    if (proxiedUrl) return proxiedUrl;
  } catch {
    // Fall through to the raw feed URL.
  }

  return feedUrl;
}

export function isGoogleNewsFeedUrl(feedUrl: string): boolean {
  try {
    const parsed = new URL(resolveOriginalFeedUrl(feedUrl));
    return parsed.hostname.toLowerCase() === 'news.google.com';
  } catch {
    return false;
  }
}

function extractPublisherFromGoogleTitle(title: string): string | null {
  const match = normalizeWhitespace(title).match(/\s[-–—]\s([^–—]+)$/u);
  return cleanPublisherLabel(match?.[1] || null);
}

function extractPublisherFromDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const fontMatch = description.match(/<font[^>]*>([^<]+)<\/font>/iu);
  if (fontMatch?.[1]) return cleanPublisherLabel(fontMatch[1]);
  return null;
}

function extractPublisherFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (!hostname || hostname === 'news.google.com') return null;
    return hostname;
  } catch {
    return null;
  }
}

function stripPublisherSuffixFromTitle(title: string, publisher: string): string {
  const normalizedTitle = normalizeWhitespace(title);
  const escapedPublisher = publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = normalizedTitle.replace(new RegExp(`\\s[-–—]\\s${escapedPublisher}$`, 'iu'), '').trim();
  return stripped || normalizedTitle;
}

export function normalizeFeedItemMetadata(input: {
  feedName: string;
  feedUrl: string;
  title: string;
  link: string;
  sourceText?: string | null;
  sourceUrl?: string | null;
  description?: string | null;
}): { source: string | null; title: string } {
  const title = normalizeWhitespace(input.title);
  if (!isGoogleNewsFeedUrl(input.feedUrl)) {
    return {
      source: cleanPublisherLabel(input.feedName) || input.feedName,
      title,
    };
  }

  const publisher = cleanPublisherLabel(input.sourceText)
    || extractPublisherFromDescription(input.description)
    || extractPublisherFromGoogleTitle(title)
    || extractPublisherFromUrl(input.sourceUrl)
    || extractPublisherFromUrl(input.link);

  if (!publisher) {
    return { source: null, title };
  }

  return {
    source: publisher,
    title: stripPublisherSuffixFromTitle(title, publisher),
  };
}
