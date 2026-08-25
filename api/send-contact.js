const CONTACT_TO = "reachvergel@gmail.com";
const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function hasExpectedSignature(contentType, bytes) {
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Email service is not configured yet." });
  }

  const name = clean(req.body?.name, 120);
  const email = clean(req.body?.email, 200);
  const subject = clean(req.body?.subject, 180) || "PriceTrack PH contact";
  const message = clean(req.body?.message, 5000);
  const rawAttachment = req.body?.attachment;
  let attachment;

  if (!message) {
    return res.status(400).json({ error: "Please enter a message." });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  if (rawAttachment != null) {
    const filename = clean(rawAttachment.filename, 180).replace(/[\\/\r\n]/g, "_");
    const contentType = clean(rawAttachment.contentType, 100);
    const content = String(rawAttachment.content ?? "").replace(/\s/g, "");

    if (!filename || !ATTACHMENT_TYPES.has(contentType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      return res.status(400).json({ error: "Attachment must be a JPG, PNG, WebP, or PDF file." });
    }
    const bytes = Buffer.from(content, "base64");
    if (!content || bytes.length > ATTACHMENT_MAX_BYTES) {
      return res.status(400).json({ error: "Attachment must be 2 MB or smaller." });
    }
    if (!hasExpectedSignature(contentType, bytes)) {
      return res.status(400).json({ error: "Attachment content does not match its file type." });
    }
    attachment = { filename, content, content_type: contentType };
  }

  const text = [
    `Name: ${name || "Not provided"}`,
    `Email: ${email || "Not provided"}`,
    "",
    message,
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PriceTrack PH <onboarding@resend.dev>",
        to: [CONTACT_TO],
        subject: `[PriceTrack PH] ${subject}`,
        text,
        ...(attachment ? { attachments: [attachment] } : {}),
        ...(email ? { reply_to: email } : {}),
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Resend contact error", response.status, payload);
      return res.status(502).json({ error: "Message could not be sent. Please try again." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Contact email error", error);
    return res.status(500).json({ error: "Message could not be sent. Please try again." });
  }
}
