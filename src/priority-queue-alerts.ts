export const priorityNoticeEnabledKey = "pricetrack-priority-due-notifications";
const priorityNoticeSeenKey = "pricetrack-priority-due-seen";
export const priorityNoticeChangeEvent = "pricetrack-priority-alerts-changed";

export async function savePriorityPushSubscription(token: string) {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const keyResponse = await fetch("/api/priority-push?action=key", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
    });
    if (!keyResponse.ok) throw new Error("Background notifications are not configured yet.");
    const { publicKey } = await keyResponse.json() as { publicKey: string };
    const decoded = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
    const key = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const response = await fetch("/api/priority-push?action=subscribe", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ subscription }),
  });
  if (!response.ok) throw new Error("Could not save this device for background alerts.");
}

export async function removePriorityPushSubscription(token: string) {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch("/api/priority-push?action=unsubscribe", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error("Could not turn off background alerts.");
  await subscription.unsubscribe();
}

export function startPriorityQueueAlerts() {
  let checking = false;
  const checkDue = async () => {
    const token = sessionStorage.getItem("pricetrack-admin-health-token");
    if (checking || !token || localStorage.getItem(priorityNoticeEnabledKey) !== "true"
      || !("Notification" in window) || Notification.permission !== "granted") return;
    checking = true;
    try {
      const response = await fetch("/api/admin-pc-collector?action=priority-due-notifications", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}", cache: "no-store",
      });
      if (!response.ok) return;
      const { due } = await response.json() as { due: Array<{ request_id: string; eligible_at: string }> };
      const keys = due.map(({ request_id, eligible_at }) => `${request_id}:${eligible_at}`);
      const seen = new Set<string>(JSON.parse(localStorage.getItem(priorityNoticeSeenKey) || "[]"));
      const newlyDue = keys.filter((key) => !seen.has(key));
      if (newlyDue.length) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("Priority Queue ready", {
          body: `${newlyDue.length} product${newlyDue.length === 1 ? " is" : "s are"} available to check.`,
          icon: "/icons/icon-192.png", tag: "priority-queue-due", data: { url: "/admin/collector" },
        });
      }
      localStorage.setItem(priorityNoticeSeenKey, JSON.stringify(keys));
    } catch {
      // Retry on the next poll without acknowledging missed items.
    } finally { checking = false; }
  };
  void checkDue();
  window.setInterval(() => void checkDue(), 60_000);
  window.addEventListener(priorityNoticeChangeEvent, () => void checkDue());
  window.addEventListener("storage", (event) => {
    if (event.key === priorityNoticeEnabledKey) void checkDue();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkDue();
  });
}
