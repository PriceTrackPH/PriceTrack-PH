import crypto from "node:crypto";

const b64 = (value) => Buffer.from(value).toString("base64url");
const unb64 = (value) => Buffer.from(value, "base64url");
const hkdf = (salt, input, info, length) => Buffer.from(crypto.hkdfSync("sha256", input, salt, info, length));

export function vapidKeys(secret) {
  if (!secret) throw new Error("Push signing secret is unavailable");
  const privateKey = hkdf(Buffer.from("PriceTrack PH VAPID 1"), Buffer.from(secret), Buffer.from("p256v1"), 32);
  const pair = crypto.createECDH("prime256v1");
  pair.setPrivateKey(privateKey);
  return { privateKey: pair.getPrivateKey(), publicKey: pair.getPublicKey() };
}

export function validPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com"
        || url.hostname === "web.push.apple.com" || url.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}

export async function sendWebPush(subscription, message, secret) {
  if (!validPushEndpoint(subscription.endpoint)) throw new Error("Invalid push endpoint");
  const uaPublic = unb64(subscription.p256dh);
  const auth = unb64(subscription.auth);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error("Invalid push subscription keys");
  const vapid = vapidKeys(secret);
  const ephem = crypto.createECDH("prime256v1");
  ephem.generateKeys();
  const serverPublic = ephem.getPublicKey();
  const shared = ephem.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, serverPublic]);
  const ikm = hkdf(auth, shared, keyInfo, 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(JSON.stringify(message)), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4); recordSize.writeUInt32BE(4096);
  const body = Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, encrypted]);

  const endpoint = new URL(subscription.endpoint);
  const header = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64(JSON.stringify({ aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: "mailto:admin@pricetrackph.com" }));
  const jwk = { kty: "EC", crv: "P-256", d: b64(vapid.privateKey),
    x: b64(vapid.publicKey.subarray(1, 33)), y: b64(vapid.publicKey.subarray(33)) };
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key: crypto.createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: { Authorization: `vapid t=${header}.${payload}.${b64(signature)}, k=${b64(vapid.publicKey)}`,
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" },
    body,
    signal: AbortSignal.timeout(15000),
  });
}
