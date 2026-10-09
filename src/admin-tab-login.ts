const tokenKey = "pricetrack-admin-health-token";
const handoffPrefix = "pricetrack-admin-tab-login:";
const handoffParam = "adminTabLogin";
const lifetime = 120_000;

// Only deliberate new-tab link actions issue a one-use login handoff. The URL
// contains a random identifier, never the admin credential.
export function prepareAdminTabLogin(link: HTMLAnchorElement) {
  const token = sessionStorage.getItem(tokenKey);
  if (!token) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || !/^\/admin(?:\/|$)/.test(url.pathname)) return;
  const now = Date.now();
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(handoffPrefix)) continue;
    try {
      if (JSON.parse(localStorage.getItem(key) || "null")?.expires <= now) localStorage.removeItem(key);
    } catch { localStorage.removeItem(key); }
  }
  const id = crypto.randomUUID();
  const key = handoffPrefix + id;
  localStorage.setItem(key, JSON.stringify({ token, expires: now + lifetime, path: url.pathname }));
  const originalHref = link.href;
  url.searchParams.set(handoffParam, id);
  link.href = url.href;
  window.setTimeout(() => {
    localStorage.removeItem(key);
    if (link.href === url.href) link.href = originalHref;
  }, lifetime);
}

export function consumeAdminTabLogin() {
  const url = new URL(window.location.href);
  const id = url.searchParams.get(handoffParam);
  if (!id || !/^\/admin(?:\/|$)/.test(url.pathname)) return;
  const key = handoffPrefix + id;
  const value = localStorage.getItem(key);
  localStorage.removeItem(key);
  url.searchParams.delete(handoffParam);
  window.history.replaceState(window.history.state, "", url);
  try {
    const handoff = JSON.parse(value || "null");
    if (handoff && typeof handoff.token === "string" && handoff.expires > Date.now() && handoff.path === url.pathname) {
      sessionStorage.setItem(tokenKey, handoff.token);
    }
  } catch { /* An invalid or expired link requires the normal login. */ }
}
