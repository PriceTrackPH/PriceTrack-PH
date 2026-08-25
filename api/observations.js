const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function setCors(res) {
  for (const [name, value] of Object.entries(corsHeaders)) res.setHeader(name, value);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !publishableKey) {
    return res.status(503).json({ error: "Collector is not configured" });
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/record-price`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${publishableKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (error) {
    console.error("Observation collector proxy error", error);
    return res.status(502).json({ error: "Unable to reach the price collector" });
  }
}
