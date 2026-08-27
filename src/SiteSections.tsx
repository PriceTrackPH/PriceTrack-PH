import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
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
    if (!footerModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
  }, [footerModal]);

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
