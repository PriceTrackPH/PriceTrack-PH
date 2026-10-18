import { useEffect } from "react";
import "./firefox-extension.css";

export default function FirefoxExtension() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Firefox Extension — PriceTrack PH";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="health-page firefox-page">
      <div className="health-shell firefox-setup">
      <a className="firefox-back" href="/">← Back to PriceTrack PH</a>
      <header className="health-heading firefox-heading">
        <div>
          <span className="health-kicker">FIREFOX EXTENSION</span>
          <h1 id="firefox-heading">Track Shopee prices with Firefox.</h1>
          <p>Record public product prices while browsing Shopee, then open the recorded price history with PriceTrack PH.</p>
        </div>
      </header>
      <section className="firefox-setup-card firefox-install-panel" aria-label="Install the Firefox extension">
        <a className="firefox-install-button" href="https://addons.mozilla.org/firefox/addon/pricetrackph/" target="_blank" rel="noreferrer">Install from Firefox Add-ons <span aria-hidden="true">↗</span></a>
        <p className="firefox-install-note">Open the install link in Firefox. It takes you to the official Mozilla add-on page.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-android-heading">
        <h2 id="firefox-android-heading">Set up on Android</h2>
        <ol className="firefox-setup-steps">
          <li><strong>Install in Firefox.</strong> Open this page in Firefox for Android, follow the install link above, and approve the extension permissions.</li>
          <li><strong>Open a Shopee product.</strong> Use the Shopee website in Firefox.</li>
          <li><strong>Enable Desktop site.</strong> Open the Firefox menu and turn on Desktop site for Shopee.</li>
          <li><strong>Reload the product page.</strong> Wait for the product to load. The extension will attempt to record its prices automatically.</li>
          <li><strong>View the history.</strong> Open PriceTrack PH from the Firefox extensions menu to check the recording status and view price history.</li>
        </ol>
        <p className="firefox-important"><strong>Desktop site is required for mobile recording.</strong> This Android extension does not run inside the Shopee app or Firefox on iPhone and iPad.</p>
      </section>
      <section className="firefox-setup-card" aria-labelledby="firefox-help-heading">
        <h2 id="firefox-help-heading">If recording does not finish</h2>
        <p>Confirm Desktop site is enabled, check your internet connection, then reload the product page and try again. If Shopee asks for verification, complete it before reloading.</p>
        <h2>Using Firefox on a computer?</h2>
        <p>Install the same extension from Firefox Add-ons, then open a Shopee product page. You do not need to enable Desktop site on a computer.</p>
      </section>
      </div>
    </main>
  );
}
