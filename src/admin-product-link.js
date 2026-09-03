export function healthProductLinkProps(shopId, productId) {
  if (!shopId || !productId) return null;
  return {
    href: `/product/shopee/${shopId}/${productId}`,
    target: '_blank',
    rel: 'noreferrer',
  };
}
