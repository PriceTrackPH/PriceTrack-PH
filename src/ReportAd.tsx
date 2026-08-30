import { useEffect, useRef, useState } from "react";

type AdSettings = {
  adsEnabled: boolean;
  publisherId: string | null;
  reportSlotId: string | null;
};

declare global {
  interface Window { adsbygoogle?: unknown[]; }
}

export default function ReportAd() {
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/site-settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (active) setSettings(payload); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!settings?.adsEnabled || !settings.publisherId || requested.current) return;
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
  }, [settings]);

  if (!settings?.adsEnabled || !settings.publisherId || !settings.reportSlotId) return null;

  return (
    <aside className="report-ad" aria-label="Advertisement">
      <span>ADVERTISEMENT</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={settings.publisherId}
        data-ad-slot={settings.reportSlotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
