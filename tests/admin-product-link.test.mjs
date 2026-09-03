import assert from 'node:assert/strict';
import test from 'node:test';

import { healthProductLinkProps } from '../src/admin-product-link.js';

test('opens a health-event product report in a new PriceTrack PH tab', () => {
  assert.deepEqual(healthProductLinkProps('943728024', '43700712442'), {
    href: '/product/shopee/943728024/43700712442',
    target: '_blank',
    rel: 'noreferrer',
  });
});

test('does not create a product link when either identifier is missing', () => {
  assert.equal(healthProductLinkProps(null, '43700712442'), null);
  assert.equal(healthProductLinkProps('943728024', null), null);
});
