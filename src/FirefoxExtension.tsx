import { useEffect } from "react";
import "./firefox-extension.css";

export default function FirefoxExtension() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Mobile Extensions — PriceTrack PH";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="health-page firefox-page">
      <div className="health-shell firefox-setup">
      <header className="health-heading firefox-heading">
        <div>
          <span className="health-kicker">MOBILE EXTENSIONS</span>
          <h1 id="firefox-heading">Track Shopee prices on Android</h1>
          <p>Record public product prices while browsing Shopee on your Android phone using Firefox or Microsoft Edge with Desktop site enabled. Then view the recorded price history with PriceTrack PH.</p>
        </div>
      </header>
      <section className="firefox-setup-card firefox-install-panel" aria-label="Mobile extension installation">
        <h2>Firefox for Android</h2>
        <a className="firefox-install-button" href="https://addons.mozilla.org/firefox/addon/pricetrackph/" target="_blank" rel="noreferrer">Install from Firefox Add-ons <span aria-hidden="true">↗</span></a>
        <p className="firefox-install-note">Open the install link in Firefox on your Android phone. It takes you to the official Mozilla add-on page.</p>

      </section>
      <section className="firefox-setup-card firefox-install-panel" aria-labelledby="edge-android-heading">
        <h2 id="edge-android-heading">Microsoft Edge for Android</h2>
        <p>Use the PriceTrack PH Edge extension in Microsoft Edge on your Android phone. Open Shopee in Edge, enable Desktop site, and reload the product page to record public prices.</p>
        <a className="firefox-install-button" href="https://microsoftedge.microsoft.com/addons/detail/pricetrack-ph/aiohoonljnggfafpfgcmeagggbjeebnk" target="_blank" rel="noreferrer">Install from Microsoft Edge Add-ons <span aria-hidden="true">↗</span></a>
        <p className="firefox-install-note">Open the install link in Microsoft Edge on your Android phone. It takes you to the official Microsoft Edge add-on page.</p>
      </section>
      <section className="firefox-setup-card" aria-label="iPhone and iPad support">
        <p ><strong>iPhone and iPad support is planned.</strong> We’re exploring a way to bring automatic price recording to iOS. It isn’t available yet, and there’s no confirmed release date. You can still use the PriceTrack PH website to view price history and save products to your Watchlist.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-android-heading">
        <h2 id="firefox-android-heading">Set up on Android</h2>
        <ol className="firefox-setup-steps">
          <li><strong>Install the matching extension.</strong> Use the Firefox extension in Firefox for Android, or the Edge extension in Microsoft Edge for Android. Approve the requested extension permissions.</li>
          <li><strong>Open a Shopee product.</strong> Use the Shopee website in the browser where you installed the extension.</li>
          <li><strong>Enable Desktop site.</strong> Open your browser menu and turn on Desktop site for Shopee.</li>
          <li><strong>Reload the product page.</strong> Wait for the product to load. The extension will attempt to record its prices automatically.</li>
          <li><strong>View the history.</strong> Open PriceTrack PH from your browser’s extensions menu to check the recording status and view price history.</li>
        </ol>
        <p className="firefox-important"><strong>Desktop site is required for mobile recording.</strong> The mobile extensions do not run inside the Shopee app. Automatic recording on iPhone and iPad is not available yet.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-help-heading">
        <h2 id="firefox-help-heading">If recording does not finish</h2>
        <p>Confirm Desktop site is enabled, check your internet connection, then reload the product page and try again. If Shopee asks for verification, complete it before reloading.</p>
      </section>
      </div>
    </main>
  );
}
