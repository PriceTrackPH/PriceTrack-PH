export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const title = typeof req.query?.title === 'string' ? req.query.title.trim() : '';
  if (!title || title.length > 500) {
    return res.status(400).json({ error: 'A valid product title is required.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !publishableKey) {
    return res.status(500).json({ error: 'Product search is not configured right now.' });
  }

  const escapedTitle = title.replace(/([\\%_])/g, '\\$1');
  const normalizeTitle = (value) => value
    .normalize('NFKC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');

  try {
    const searchProducts = async (nameFilter, limit) => {
      const endpoint = new URL('/rest/v1/products', supabaseUrl);
      endpoint.searchParams.set('select', 'external_shop_id,external_product_id,product_url,name');
      endpoint.searchParams.set('platform', 'eq.shopee');
      endpoint.searchParams.set('name', nameFilter);
      endpoint.searchParams.set('limit', String(limit));

      const response = await fetch(endpoint, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) throw new Error('Product search failed.');
      const rows = await response.json();
      return Array.isArray(rows) ? rows : [];
    };

    let rows = await searchProducts(`ilike.${escapedTitle}`, 2);

    if (rows.length === 0) {
      const wordPattern = title
        .split(/\s+/u)
        .map((word) => word.replace(/([\\%_])/g, '\\$1'))
        .join('*');
      const possibleRows = await searchProducts(`ilike.${wordPattern}`, 50);
      const normalizedTitle = normalizeTitle(title);
      rows = possibleRows.filter((product) => {
        const productName = typeof product.name === 'string' ? product.name.trim() : '';
        return normalizeTitle(productName) === normalizedTitle;
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No exact product title match found in the PriceTrack database.' });
    }

    if (rows.length > 1) {
      return res.status(409).json({ error: 'More than one product has this exact title. Please use the Shopee product link instead.' });
    }

    const product = rows[0];
    const productUrl = typeof product.product_url === 'string' ? product.product_url.trim() : '';
    if (!/^https:\/\/(?:[^/]+\.)?shopee\.ph\//i.test(productUrl)) {
      return res.status(422).json({ error: 'This exact product was found, but its Shopee link is unavailable.' });
    }

    return res.status(200).json({
      productUrl,
      shopId: String(product.external_shop_id ?? ''),
      productId: String(product.external_product_id ?? ''),
      title: product.name,
    });
  } catch {
    return res.status(502).json({ error: 'Could not search the PriceTrack database right now.' });
  }
}
