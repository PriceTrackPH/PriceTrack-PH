export type HealthProductLinkProps = {
  href: string;
  target: "_blank";
  rel: "noreferrer";
};

export function healthProductLinkProps(
  shopId: string | null,
  productId: string | null,
): HealthProductLinkProps | null;
