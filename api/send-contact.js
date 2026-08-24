const CONTACT_TO = "reachvergel@gmail.com";

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
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

  if (!message) {
    return res.status(400).json({ error: "Please enter a message." });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
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
