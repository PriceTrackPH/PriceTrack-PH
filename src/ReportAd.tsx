import { useEffect, useRef, useState } from "react";

type AdSettings = {
  adsEnabled: boolean;
  publisherId: string | null;
  reportSlotId: string | null;
  topSlotId: string | null;
};

declare global {
  interface Window { adsbygoogle?: unknown[]; }
}

type ReportAdProps = {
  placement?: "report" | "top";
};

export default function ReportAd({ placement = "report" }: ReportAdProps) {
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const requested = useRef(false);
  const slotId = placement === "top" ? settings?.topSlotId : settings?.reportSlotId;

  useEffect(() => {
    let active = true;
    fetch("/api/site-settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (active) setSettings(payload); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!settings?.adsEnabled || !settings.publisherId || !slotId || requested.current) return;
    const scriptId = "pricetrack-adsense-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(settings.publisherId)}`;
      document.head.appendChild(script);
    }
    requested.current = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.push({});
  }, [settings, slotId]);

  if (!settings?.adsEnabled || !settings.publisherId || !slotId) return null;

  return (
    <aside className={`report-ad ${placement === "top" ? "top-ad" : "result-ad"}`} aria-label="Advertisement">
      <span>ADVERTISEMENT</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={settings.publisherId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
