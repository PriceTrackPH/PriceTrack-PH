import { supabase } from "./lib/supabase";

export type AdminHistoryEvent = { kind: "collector" | "store" | "collector-progress"; status: string; id: string; originSessionId?: string };

export function subscribeToAdminHistory(onEvent: (event: AdminHistoryEvent) => void) {
  const channel = supabase?.channel("admin-history-changed", { config: { broadcast: { self: false } } });
  channel?.on("broadcast", { event: "history-changed" }, ({ payload }) => onEvent(payload as AdminHistoryEvent)).subscribe();
  return {
    publish(event: AdminHistoryEvent) {
      return channel?.send({ type: "broadcast", event: "history-changed", payload: event });
    },
    unsubscribe() {
      if (channel && supabase) void supabase.removeChannel(channel);
    },
  };
}
