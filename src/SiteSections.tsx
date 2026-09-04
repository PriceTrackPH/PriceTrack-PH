import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import gcashQr from "./assets/donation-gcash-qr.jpg";
import mayaQr from "./assets/donation-maya-qr.jpg";
import bankQr from "./assets/donation-bank-qr.jpg";
import { donationPageIndex } from "./donation-pagination";
import "./contact-attachment.css";

type FooterModalKey = "about" | "privacy" | "data" | "contact";
type ContactDraft = { name: string; email: string; subject: string; message: string; savedAt: number };
type ContactSendState = "idle" | "sending" | "sent" | "error";

const CONTACT_DRAFT_KEY = "pricetrackph-contact-draft";
const CONTACT_DRAFT_TTL = 24 * 60 * 60 * 1000;
const CONTACT_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const CONTACT_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type ContactAttachment = { filename: string; contentType: string; content: string };

const footerModalContent: Record<FooterModalKey, { label: string; title: string; body: ReactNode }> = {
  about: {
    label: "ABOUT PRICETRACK PH",
    title: "Independent price history for smarter shopping.",
    body: (
      <>
        <p>PriceTrack PH is an independent price-history tool that helps shoppers compare current prices with past prices before buying. We currently support Shopee product tracking, with support for more online marketplaces planned over time.</p>
        <p>PriceTrack PH is independent and is not affiliated with or endorsed by the marketplaces it tracks. Price, stock, vouchers, shipping, and checkout totals may change, so the original marketplace listing remains the final source.</p>
      </>
    ),
  },
  privacy: {
    label: "PRIVACY",
    title: "Built to work without shopper accounts.",
    body: (
      <>
        <p>PriceTrack PH does not require you to create an account to view public price history.</p>
        <p>The tracker is designed around public product information needed to identify listings, variations, availability, and recorded prices. It is not intended to collect private marketplace account information.</p>
      </>
    ),
  },
  data: {
    label: "DATA POLICY",
    title: "What the tracker records.",
    body: (
      <>
        <p>PriceTrack PH stores product identifiers, public listing details, variation names, recorded prices, stock status, and observation times needed to build price history.</p>
        <p>Multiple observations from the same day may be kept when the public price changes. Historical data is shown as a shopping reference and may not represent vouchers, personalized discounts, shipping fees, or the final checkout total.</p>
      </>
    ),
  },
  contact: {
    label: "CONTACT",
    title: "Questions, bugs, or feedback?",
    body: null,
  },
};

function SiteSections() {
  const chromeWebStoreUrl = "https://chromewebstore.google.com/detail/ilabeaeblpcleaipmnppibbfhjknlmeo";
  const isAdminPage = ["/admin", "/admin/", "/admin/health", "/admin/health/", "/admin/affiliate", "/admin/affiliate/", "/admin/ads", "/admin/ads/", "/admin/collector", "/admin/collector/", "/admin/monitoring", "/admin/monitoring/"].includes(window.location.pathname);
  const [donationOpen, setDonationOpen] = useState(false);
  const [donationQrIndex, setDonationQrIndex] = useState(0);
  const [footerModal, setFooterModal] = useState<FooterModalKey | null>(null);
  const [contactDraft, setContactDraft] = useState<Omit<ContactDraft, "savedAt">>({ name: "", email: "", subject: "", message: "" });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [contactSendState, setContactSendState] = useState<ContactSendState>("idle");
  const [contactSendMessage, setContactSendMessage] = useState("");
  const [contactAttachment, setContactAttachment] = useState<ContactAttachment | null>(null);
  const contactAttachmentInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONTACT_DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as ContactDraft;
        if (Date.now() - Number(saved.savedAt) < CONTACT_DRAFT_TTL) {
          setContactDraft({ name: saved.name || "", email: saved.email || "", subject: saved.subject || "", message: saved.message || "" });
        } else {
          localStorage.removeItem(CONTACT_DRAFT_KEY);
        }
      }
    } catch {
      localStorage.removeItem(CONTACT_DRAFT_KEY);
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    const hasText = Object.values(contactDraft).some((value) => value.trim().length > 0);
    if (!hasText) {
      localStorage.removeItem(CONTACT_DRAFT_KEY);
      return;
    }
    localStorage.setItem(CONTACT_DRAFT_KEY, JSON.stringify({ ...contactDraft, savedAt: Date.now() }));
  }, [contactDraft, draftLoaded]);

  useEffect(() => {
    if (!donationOpen && !footerModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDonationOpen(false);
        setFooterModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [donationOpen, footerModal]);

  useEffect(() => {
    if (donationOpen) setDonationQrIndex(0);
  }, [donationOpen]);

  const activeFooterModal = footerModal ? footerModalContent[footerModal] : null;

  const updateContactDraft = (field: keyof Omit<ContactDraft, "savedAt">, value: string) => {
    setContactDraft((current) => ({ ...current, [field]: value }));
    if (contactSendState !== "idle") {
      setContactSendState("idle");
      setContactSendMessage("");
    }
  };

  const selectContactAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setContactSendState("idle");
    setContactSendMessage("");

    if (!file) {
      setContactAttachment(null);
      return;
    }
    if (!CONTACT_ATTACHMENT_TYPES.includes(file.type)) {
      event.target.value = "";
      setContactAttachment(null);
      setContactSendState("error");
      setContactSendMessage("Use a JPG, PNG, WebP, or PDF file.");
      return;
    }
    if (file.size > CONTACT_ATTACHMENT_MAX_BYTES) {
      event.target.value = "";
      setContactAttachment(null);
      setContactSendState("error");
      setContactSendMessage("Attachment must be 2 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const content = result.includes(",") ? result.slice(result.indexOf(",") + 1) : "";
      if (!content) {
        setContactSendState("error");
        setContactSendMessage("Attachment could not be read.");
        return;
      }
      setContactAttachment({ filename: file.name, contentType: file.type, content });
    };
    reader.onerror = () => {
      event.target.value = "";
      setContactAttachment(null);
      setContactSendState("error");
      setContactSendMessage("Attachment could not be read.");
    };
    reader.readAsDataURL(file);
  };

  const removeContactAttachment = () => {
    setContactAttachment(null);
    if (contactAttachmentInput.current) contactAttachmentInput.current.value = "";
  };

  const sendContactEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContactSendState("sending");
    setContactSendMessage("");

    try {
      const response = await fetch("/api/send-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contactDraft, attachment: contactAttachment }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Message could not be sent.");
      }

      localStorage.removeItem(CONTACT_DRAFT_KEY);
      setContactDraft({ name: "", email: "", subject: "", message: "" });
      removeContactAttachment();
      setContactSendState("sent");
      setContactSendMessage("Message sent. Thank you!");
    } catch (error) {
      setContactSendState("error");
      setContactSendMessage(error instanceof Error ? error.message : "Message could not be sent. Please try again.");
    }
  };

  return (
    <>
      {!isAdminPage && <>
        <section className="extension-section" id="extension">
          <div className="section-shell extension-grid">
            <div className="extension-copy">
              <div className="section-label">AUTOMATIC PRICE CHECKS</div>
              <h2>Automatic tracking.<br />One useful button.</h2>
              <p>Open a Shopee product and PriceTrack PH checks its public price automatically. Click the extension only when you want to view the complete report.</p>
              <ol className="steps-list">
                <li><span>1</span>Detects the product you are viewing</li>
                <li><span>2</span>Saves each day&apos;s first price and any later changes</li>
                <li><span>3</span>Opens the full report from one button</li>
              </ol>
              <a className="chrome-install" href={chromeWebStoreUrl} target="_blank" rel="noreferrer">Add to Chrome <span>↗</span></a>
            </div>
            <div className="extension-preview" aria-label="PriceTrack extension preview">
              <div className="browser-dots"><span /><span /><span /></div>
              <div className="preview-card">
                <strong>PriceTrack <em>PH</em></strong>
                <div className="detected-box"><b>✓</b><div><strong>Shopee product detected</strong><small>Ready to check this item</small></div></div>
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
              <article><span>01</span><h3>No hidden tracking</h3><p>We only collect product information required to build useful public price history.</p></article>
              <article><span>02</span><h3>Ads stay separate</h3><p>Advertisements will be clearly marked and never imitate product or navigation buttons.</p></article>
              <article><span>03</span><h3>Affiliate disclosure</h3><p>If a purchase link earns commission, you will see the disclosure before clicking it.</p></article>
            </div>
          </div>
        </section>

        <section className="support-section" id="support">
          <div className="section-shell support-card">
            <div>
              <div className="section-label">KEEP THE TRACKER FREE</div>
              <h3>Support independent price tracking.</h3>
              <p>Donations help pay for daily price checks, storage, and alerts. All core history remains free.</p>
            </div>
            <button type="button" onClick={() => setDonationOpen(true)}>♡ Donate to PriceTrack PH</button>
          </div>
        </section>
      </>}

      {donationOpen && !isAdminPage && <div className="donation-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDonationOpen(false); }}>
        <section className="donation-modal" role="dialog" aria-modal="true" aria-labelledby="donation-title">
          <button className="donation-modal-close" type="button" aria-label="Close donation window" onClick={() => setDonationOpen(false)}>×</button>
          <div className="donation-modal-heading">
            <div className="section-label">SUPPORT PRICETRACK PH</div>
            <h3 id="donation-title">Choose a QR code to donate.</h3>
            <p>Scan the option that works best for you.</p>
          </div>
          <div className="donation-qr-grid" onScroll={(event) => setDonationQrIndex(donationPageIndex(event.currentTarget.scrollLeft, event.currentTarget.clientWidth, 3))}>
            {[{ label: "GCash", src: gcashQr }, { label: "Maya", src: mayaQr }, { label: "Bank / QR Ph", src: bankQr }].map((item) => <div className="donation-qr-card" key={item.label}><img className="donation-qr-image" src={item.src} alt={`${item.label} donation QR code`} /><strong>{item.label}</strong></div>)}
          </div>
          <div className="donation-qr-dots" role="status" aria-label={`QR code ${donationQrIndex + 1} of 3`}>
            {[0, 1, 2].map((index) => <span className={index === donationQrIndex ? "active" : ""} aria-hidden="true" key={index} />)}
          </div>
          <p className="donation-thanks">Thank you for helping keep PriceTrack PH free.</p>
        </section>
      </div>}

      {activeFooterModal && <div className="footer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFooterModal(null); }}><section className="footer-modal" role="dialog" aria-modal="true" aria-labelledby="footer-modal-title"><button className="footer-modal-close" type="button" aria-label="Close information window" onClick={() => setFooterModal(null)}>×</button><div className="section-label">{activeFooterModal.label}</div><h3 id="footer-modal-title">{activeFooterModal.title}</h3><div className="footer-modal-body">{footerModal === "contact" ? <form className="contact-form" onSubmit={sendContactEmail}>
        <p>For product-tracking issues, website bugs, feature requests, or general feedback, email PriceTrack PH directly.</p>
        <label>Name<input value={contactDraft.name} onChange={(e) => updateContactDraft("name", e.target.value)} autoComplete="name" /></label>
        <label>Email<input type="email" value={contactDraft.email} onChange={(e) => updateContactDraft("email", e.target.value)} autoComplete="email" /></label>
        <label>Subject<input value={contactDraft.subject} onChange={(e) => updateContactDraft("subject", e.target.value)} /></label>
        <label>Message<textarea required rows={6} value={contactDraft.message} onChange={(e) => updateContactDraft("message", e.target.value)} /></label>
        <label>Attachment <span className="contact-optional">(optional)</span><input ref={contactAttachmentInput} className="contact-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={selectContactAttachment} /></label>
        <div className="contact-attachment-note">JPG, PNG, WebP, or PDF · maximum 2 MB</div>
        {contactAttachment && <div className="contact-attachment-selected"><span title={contactAttachment.filename}>{contactAttachment.filename}</span><button type="button" onClick={removeContactAttachment}>Remove</button></div>}
        <div className="contact-form-actions"><button className="footer-modal-action" type="submit" disabled={contactSendState === "sending"}>{contactSendState === "sending" ? "Sending..." : "Send message ↗"}</button></div>
        {contactSendMessage && <p className={`contact-send-status ${contactSendState}`}>{contactSendMessage}</p>}
      </form> : activeFooterModal.body}</div></section></div>}

      <footer className="full-footer"><div className="section-shell"><div className="footer-main"><div><strong>PriceTrack <span>PH</span></strong><small>Independent price history for smarter shopping.</small></div><nav aria-label="Footer navigation"><button type="button" onClick={() => setFooterModal("about")}>About</button><button type="button" onClick={() => { window.location.href = "/privacy/"; }}>Privacy</button><button type="button" onClick={() => setFooterModal("data")}>Data policy</button><button type="button" onClick={() => setFooterModal("contact")}>Contact</button></nav></div><div className="footer-disclaimer">PriceTrack PH is independent and is not affiliated with or endorsed by the marketplaces it tracks.</div></div></footer>
    </>
  );
}

export default SiteSections;
