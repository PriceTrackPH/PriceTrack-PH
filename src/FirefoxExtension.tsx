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
          <p>Use PriceTrack PH in Firefox or Microsoft Edge on your Android phone to record public Shopee prices as you browse and follow their recorded history.</p>
        </div>
      </header>
      <section className="firefox-setup-card firefox-install-panel" aria-label="Mobile extension installation">
        <h2>Firefox for Android</h2>
        <a className="firefox-install-button" href="https://addons.mozilla.org/firefox/addon/pricetrackph/" target="_blank" rel="noreferrer">Install from Firefox Add-ons <span aria-hidden="true">↗</span></a>
        <p className="firefox-install-note">Open this link in Firefox for Android and install PriceTrack PH from the official Mozilla add-on page.</p>

      </section>
      <section className="firefox-setup-card firefox-install-panel" aria-labelledby="edge-android-heading">
        <h2 id="edge-android-heading">Microsoft Edge for Android</h2>
        <a className="firefox-install-button" href="https://microsoftedge.microsoft.com/addons/detail/pricetrack-ph/aiohoonljnggfafpfgcmeagggbjeebnk" target="_blank" rel="noreferrer">Install from Microsoft Edge Add-ons <span aria-hidden="true">↗</span></a>
        <p className="firefox-install-note">Open this link in Microsoft Edge for Android and install PriceTrack PH from the official Microsoft Edge add-on page.</p>
      </section>
      <section className="firefox-setup-card" aria-label="iPhone and iPad support">
        <h2>Using an iPhone or iPad?</h2>
        <p>Automatic price recording is not available on iOS yet. We’re exploring support, but there’s no release date. You can still visit PriceTrack PH to view recorded prices and save products to your Watchlist.</p>
        <p>You can also paste a supported product link into PriceTrack PH and tap <strong>Check price</strong> in your iPhone or iPad browser—no extension needed. If the product hasn’t been recorded yet, it is submitted to the collection queue. If it’s already recorded, you’ll see its saved price history, and any new collection request follows the existing queue eligibility rules. Submitting a link requests collection; it does not immediately record prices from your iOS browser.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-android-heading">
        <h2 id="firefox-android-heading">How to record prices</h2>
        <ol className="firefox-setup-steps">
          <li><strong>Allow the extension to run.</strong> After installing, approve the permissions requested by your browser.</li>
          <li><strong>Open a product.</strong> Visit the Shopee website in the browser where you installed PriceTrack PH.</li>
          <li><strong>Enable Desktop site.</strong> Open your browser menu and turn on Desktop site for Shopee.</li>
          <li><strong>Reload and wait.</strong> Let the product page finish loading so the extension can attempt to record its prices automatically.</li>
          <li><strong>Check the result.</strong> Open PriceTrack PH from your browser’s extensions menu to see the recording status and open the product’s price history.</li>
        </ol>
        <p className="firefox-important"><strong>Use the Shopee website.</strong> Recording works in the browser with Desktop site enabled, not inside the Shopee app.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-help-heading">
        <h2 id="firefox-help-heading">Having trouble recording?</h2>
        <p>Check that PriceTrack PH is enabled and has permission to run on Shopee. If the page stays loading or recording does not finish, check your internet connection and reload. Complete any Shopee verification before trying again.</p>
      </section>
      </div>
    </main>
  );
}
