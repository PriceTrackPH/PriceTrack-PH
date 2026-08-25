export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const raw = typeof req.query?.url === 'string' ? req.query.url.trim() : '';
  if (!raw || raw.length > 2048) {
    return res.status(400).json({ error: 'A valid Shopee link is required.' });
  }

  let source;
  try {
    source = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'That is not a valid URL.' });
  }

  const allowedInputHosts = new Set(['s.shopee.ph', 'ph.shp.ee', 'shopee.ph', 'www.shopee.ph']);
  if (source.protocol !== 'https:' || !allowedInputHosts.has(source.hostname.toLowerCase())) {
    return res.status(400).json({ error: 'Please paste a Shopee Philippines link.' });
  }

  const parseIds = (value) => {
    const url = new URL(value);
    if (!/(^|\.)shopee\.ph$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/-i\.(\d+)\.(\d+)/i) || url.pathname.match(/\/product\/(\d+)\/(\d+)/i);
    return match ? { shopId: match[1], productId: match[2], resolvedUrl: url.toString() } : null;
  };

  const direct = parseIds(source.toString());
  if (direct) return res.status(200).json(direct);

  try {
    const response = await fetch(source.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; PriceTrackPH/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });

    const resolved = parseIds(response.url);
    if (!resolved) {
      return res.status(422).json({ error: 'The short link resolved, but no Shopee product IDs were found.' });
    }

    return res.status(200).json(resolved);
  } catch {
    return res.status(502).json({ error: 'Could not resolve that Shopee short link right now.' });
  }
}
