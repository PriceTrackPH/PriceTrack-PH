import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../src/AdminCollector.tsx', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  function reservationPayload('), source.indexOf('  async function runCollection()'));
function setup(api) {
  const ref = (current) => ({ current });
  const context = {
    reservedProducts: ref([]), reservationFill: ref(null), reservationGeneration: ref(0),
    activeProduct: ref(null), stopped: ref(false), stopRequested: ref(false),
    nqCycle: ref({ recorded: 0, lowDone: false }), backlogId: ref(null),
    attemptedProductIds: ref(new Set()), attemptedQueueRequestIds: ref(new Set()), attemptedStoreRequestIds: ref(new Set()),
    lastClaimedShopId: ref(null), nonPriorityCadence: ref(0),
    includeStoreImports: true, includeNormalQueue: true, includePriorityQueue: true, includePersonalQueue: true,
    skipSoldOut: true, skipUnchangedDay: true, api,
    advanceNqCycle: (s) => ({ ...s, recorded: s.recorded + 1 }), nqCycleMode: () => null,
    nextNonPrioritySource: () => 'normal',
  };
  const js = stripTypeScriptTypes(methods);
  return { ...context, ...new Function(...Object.keys(context), `${js}; return { refillReservations, clearReservations, takeReservedProduct };`)(...Object.values(context)) };
}
const product = (id, claimSource = 'random') => ({ productId: id, shopId: String(id), externalProductId: String(id), claimSource, queueRequestId: claimSource === 'random' ? null : String(id), leaseUntil: new Date(Date.now() + 300_000).toISOString() });
test('fills three upcoming leases alongside active product and refills after consuming one', async () => {
  let id = 0;
  const s = setup(async () => ({ product: product(++id) }));
  s.activeProduct.current = product(100);
  s.refillReservations(); await s.reservationFill.current;
  assert.equal(s.reservedProducts.current.length, 3);
  assert.equal(id, 3);
  s.activeProduct.current = null;
  // Inspect the reserved products directly to simulate completion/dispatch.
  s.activeProduct.current = s.reservedProducts.current.shift();
  s.refillReservations(); await s.reservationFill.current;
  assert.equal(s.reservedProducts.current.length, 3);
  assert.equal(id, 4);
});
test('Stop releases both queued and in-flight reservations', async () => {
  let resolveClaim; const released = [];
  const s = setup(async (action, body) => {
    if (action === 'release') { released.push(body.productId); return {}; }
    return new Promise((resolve) => { resolveClaim = resolve; });
  });
  s.reservedProducts.current.push(product(1));
  s.refillReservations();
  s.stopRequested.current = true;
  const clearing = s.clearReservations();
  resolveClaim({ product: product(2) }); await clearing;
  assert.deepEqual(released.sort(), [1, 2]);
  assert.equal(s.reservedProducts.current.length, 0);
});
test('new priority product precedes buffered normal products', async () => {
  const s = setup(async () => ({ product: product(9, 'priority') }));
  s.reservedProducts.current.push(product(1), product(2));
  assert.equal((await s.takeReservedProduct()).productId, 9);
  assert.equal(s.reservedProducts.current.length, 2);
});
test('expired reservation is released rather than opened', async () => {
  const released = [];
  const s = setup(async (action, body) => {
    if (action === 'release') { released.push(body.productId); return {}; }
    return { product: product(2) };
  });
  s.reservedProducts.current.push({ ...product(1), leaseUntil: new Date(0).toISOString() });
  assert.equal((await s.takeReservedProduct()).productId, 2);
  assert.deepEqual(released, [1]);
});
