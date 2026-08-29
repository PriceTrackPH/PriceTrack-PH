const MAX_REDIRECTS = 12;
const MAX_HTML_BYTES = 700_000;

function isAllowedShopeeHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === 'shopee.ph' ||
    host.endsWith('.shopee.ph') ||
    host === 'ph.shp.ee' ||
    host === 'shope.ee' ||
    host.endsWith('.shope.ee')
  );
}

function decodeLoose(value) {
  let current = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');

  for (let i = 0; i < 5; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }

  return current;
}

function extractIdsFromText(rawValue, resolvedUrl = null) {
  if (typeof rawValue !== 'string' || !rawValue) return null;

  const candidates = [rawValue, decodeLoose(rawValue)];

  for (const value of candidates) {
    const directPatterns = [
      /-i\.(\d+)\.(\d+)/i,
      /\/product\/(\d+)\/(\d+)/i,
      /shopee:\/\/product\/(\d+)\/(\d+)/i,
      /(?:^|https?:\/\/(?:www\.)?shopee\.ph)\/[^/?#\s"'<>]+\/(\d{5,})\/(\d{5,})(?:[/?#\s"'<>]|$)/i,
      /(?:^|[?&#])shopid=(\d+).*?(?:^|[?&#])itemid=(\d+)/i,
      /(?:^|[?&#])shop_id=(\d+).*?(?:^|[?&#])item_id=(\d+)/i,
      /["']shop(?:id|Id|_id)["']\s*[:=]\s*["']?(\d+)["']?.{0,2000}?["']item(?:id|Id|_id)["']\s*[:=]\s*["']?(\d+)/is,
      /["']item(?:id|Id|_id)["']\s*[:=]\s*["']?(\d+)["']?.{0,2000}?["']shop(?:id|Id|_id)["']\s*[:=]\s*["']?(\d+)/is,
    ];

    for (let index = 0; index < directPatterns.length; index += 1) {
      const match = value.match(directPatterns[index]);
      if (!match) continue;
      if (index === 7) return { shopId: match[2], productId: match[1], resolvedUrl };
      return { shopId: match[1], productId: match[2], resolvedUrl };
    }

    const shopMatches = [...value.matchAll(/(?:shopid|shopId|shop_id)["'\s:=]+["']?(\d{5,})/g)];
    const itemMatches = [...value.matchAll(/(?:itemid|itemId|item_id)["'\s:=]+["']?(\d{5,})/g)];
    if (shopMatches.length && itemMatches.length) {
      return { shopId: shopMatches[0][1], productId: itemMatches[0][1], resolvedUrl };
    }
  }

  return null;
}

function parseCandidate(value, depth = 0) {
  if (!value || depth > 7) return null;

  const normalized = decodeLoose(value);
  const fromText = extractIdsFromText(normalized, normalized);
  if (fromText) return fromText;

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const protocol = url.protocol.toLowerCase();

  // Shopee's newer affiliate pages use an app deep-link wrapper such as
  // shopeeph://reactPath?navigate_url=https%3A%2F%2Fshopee.ph%2F...
  // Only inspect its nested values; the eventual web URL still has to pass
  // the Shopee-host allowlist below.
  if (protocol === 'shopee:' || protocol === 'shopeeph:') {
    const directDeepLink = extractIdsFromText(`${url.pathname}${url.search}${url.hash}`, normalized);
    if (directDeepLink) return directDeepLink;

    for (const [, paramValue] of url.searchParams) {
      const nested = parseCandidate(paramValue, depth + 1);
      if (nested) return nested;
    }

    return null;
  }

  if (!isAllowedShopeeHost(url.hostname)) return null;

  const direct = extractIdsFromText(`${url.pathname}${url.search}${url.hash}`, url.toString());
  if (direct) return direct;

  for (const [, paramValue] of url.searchParams) {
    const nested = parseCandidate(paramValue, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function extractNestedCandidates(body) {
  const normalized = decodeLoose(body);
  const candidates = new Set();

  const httpMatches = normalized.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const value of httpMatches) candidates.add(value);

  const shopeeSchemeMatches = normalized.match(/shopee(?:ph)?:\/\/[^\s"'<>]+/gi) || [];
  for (const value of shopeeSchemeMatches) candidates.add(value);

  const metaRefreshMatches = [...normalized.matchAll(/url\s*=\s*["']?([^"'\s>]+)/gi)];
  for (const match of metaRefreshMatches) candidates.add(match[1]);

  const hrefMatches = [...normalized.matchAll(/(?:href|content|url)["'\s:=]+["']([^"']+)["']/gi)];
  for (const match of hrefMatches) candidates.add(match[1]);

  const wrapperNames = [
    'origin_link', 'originLink', 'target_url', 'targetUrl', 'redirect_url', 'redirectUrl',
    'landing_url', 'landingUrl', 'landing_page_url', 'landingPageUrl', 'deep_link', 'deepLink',
    'deeplink', 'fallback_url', 'fallbackUrl', 'web_url', 'webUrl',
    'navigate_url', 'navigateUrl', 'url'
  ];

  for (const name of wrapperNames) {
    const re = new RegExp(`${name}["'\\s:=]+["']?([^"'\\s<>]+)`, 'gi');
    for (const match of normalized.matchAll(re)) candidates.add(match[1]);
  }

  const relativeRedirects = [...normalized.matchAll(/(?:location(?:\.href)?|location\.replace|location\.assign)\s*\(?\s*["']([^"']+)["']/gi)];
  for (const match of relativeRedirects) candidates.add(match[1]);

  return [...candidates].slice(0, 400);
}

async function fetchWithManualRedirects(source) {
  let current = source;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsedCurrent = parseCandidate(current);
    if (parsedCurrent) return parsedCurrent;

    const currentUrl = new URL(current);
    if (!isAllowedShopeeHost(currentUrl.hostname)) throw new Error('Redirect left allowed Shopee hosts.');

    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-PH,en;q=0.9',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
      },
      signal: AbortSignal.timeout(10000),
    });

    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      const nextUrl = new URL(location, current).toString();
      const parsedNext = parseCandidate(nextUrl);
      if (parsedNext) return parsedNext;
      if (!isAllowedShopeeHost(new URL(nextUrl).hostname)) throw new Error('Redirect left allowed Shopee hosts.');
      current = nextUrl;
      continue;
    }

    const finalUrlMatch = parseCandidate(response.url || current);
    if (finalUrlMatch) return finalUrlMatch;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/') || contentType.includes('json') || !contentType) {
      const body = (await response.text()).slice(0, MAX_HTML_BYTES);
      const bodyVariants = [body, decodeLoose(body)];

      for (const variant of bodyVariants) {
        const bodyMatch = extractIdsFromText(variant, response.url || current);
        if (bodyMatch) return bodyMatch;

        for (const nestedValue of extractNestedCandidates(variant)) {
          const decodedNested = decodeLoose(nestedValue);
          const directNested = extractIdsFromText(decodedNested, response.url || current);
          if (directNested) return directNested;

          let absolute = decodedNested;
          try {
            absolute = new URL(decodedNested, current).toString();
          } catch {}

          const nested = parseCandidate(absolute);
          if (nested) return nested;

          try {
            const nestedUrl = new URL(absolute);
            if (isAllowedShopeeHost(nestedUrl.hostname) && absolute !== current) {
              current = absolute;
              break;
            }
          } catch {}
        }
      }

      if (current !== source && current !== (response.url || source)) continue;
    }

    break;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const raw = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
  if (!raw || raw.length > 2048) return res.status(400).json({ error: 'A valid Shopee link is required.' });

  let source;
  try {
    source = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'That is not a valid URL.' });
  }

  if (source.protocol !== 'https:' || !isAllowedShopeeHost(source.hostname)) {
    return res.status(400).json({ error: 'Please paste a Shopee Philippines link.' });
  }

  const direct = parseCandidate(source.toString());
  if (direct) return res.status(200).json(direct);

  try {
    const resolved = await fetchWithManualRedirects(source.toString());
    if (!resolved) return res.status(422).json({ error: 'The short link resolved, but no Shopee product IDs were found.' });
    return res.status(200).json(resolved);
  } catch {
    return res.status(502).json({ error: 'Could not resolve that Shopee short link right now.' });
  }
}
