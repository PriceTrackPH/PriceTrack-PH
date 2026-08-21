function SiteSections() {
  return (
    <>
      <section className="extension-section" id="extension">
        <div className="section-shell extension-grid">
          <div className="extension-copy">
            <div className="section-label">AUTOMATIC PRICE CHECKS</div>
            <h2>Automatic tracking.<br />One useful button.</h2>
            <p>
              Open a Shopee product and PriceTrack PH checks its public price automatically.
              Click the extension only when you want to view the complete report.
            </p>

            <ol className="steps-list">
              <li><span>1</span>Detects the product you are viewing</li>
              <li><span>2</span>Saves each day&apos;s first price and any later changes</li>
              <li><span>3</span>Opens the full report from one button</li>
            </ol>

            <button className="download-beta" type="button" title="Chrome extension source will be added to this repository next">
              Download Chrome beta <span>↘</span>
            </button>
          </div>

          <div className="extension-preview" aria-label="PriceTrack extension preview">
            <div className="browser-dots"><span /><span /><span /></div>
            <div className="preview-card">
              <strong>PriceTrack <em>PH</em></strong>
              <div className="detected-box">
                <b>✓</b>
                <div>
                  <strong>Shopee product detected</strong>
                  <small>Ready to check this item</small>
                </div>
              </div>
              <button type="button">View price history <span>→</span></button>
              <small>Opens PriceTrack PH in a new tab</small>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-section" id="how-it-works">
        <div className="section-shell">
          <div className="section-label">BUILT ON TRUST</div>
          <h2>Clear about where the money<br />comes from.</h2>

          <div className="trust-columns">
            <article>
              <span>01</span>
              <h3>No hidden tracking</h3>
              <p>We only collect product information required to build useful public price history.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Ads stay separate</h3>
              <p>Advertisements will be clearly marked and never imitate product or navigation buttons.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Affiliate disclosure</h3>
              <p>If a purchase link earns commission, you will see the disclosure before clicking it.</p>
            </article>
          </div>

          <div className="support-card" id="support">
            <div>
              <div className="section-label">KEEP THE TRACKER FREE</div>
              <h3>Support independent price tracking.</h3>
              <p>Donations help pay for daily price checks, storage, and alerts. All core history remains free.</p>
            </div>
            <button type="button">♡ Donate to PriceTrack PH</button>
          </div>
        </div>
      </section>

      <footer className="full-footer">
        <div className="section-shell">
          <div className="footer-main">
            <div>
              <strong>PriceTrack <span>PH</span></strong>
              <small>Independent price history for smarter shopping.</small>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#top">About</a>
              <a href="#top">Privacy</a>
              <a href="#top">Data policy</a>
              <a href="#top">Contact</a>
            </nav>
          </div>
          <div className="footer-disclaimer">PriceTrack PH is independent and is not affiliated with or endorsed by Shopee.</div>
        </div>
      </footer>
    </>
  );
}

export default SiteSections;
