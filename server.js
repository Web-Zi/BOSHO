import express from "express";
import cors from "cors";
import fs from "fs";

const { WA_TOKEN, WA_PHONE_ID, ALLOWED_ORIGIN = "*", PORT = 3000 } = process.env;
const OWNER_PHONE = process.env.OWNER_PHONE || "201555137386"; // +201555137386

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(cors({ origin: ALLOWED_ORIGIN }));

const seen = new Set();   // stops duplicate orders when the frontend retries
const hits = new Map();   // very small rate limit per IP

function formal(o) {
  const lines = o.items.map(i => `• ${i.name} × ${i.qty} = ${i.price * i.qty} ج`).join("\n");
  return [
    "*طلب جديد - البوشو*",
    `رقم الطلب: ${o.id}`,
    "",
    lines,
    "",
    `*الإجمالي: ${o.total} ج* (بدون رسوم التوصيل)`,
    "",
    `الاسم: ${o.name}`,
    `الموبايل: ${o.phone}`,
    `نوع الطلب: ${o.mode === "del" ? "توصيل" : "استلام من المطعم"}`,
    o.mode === "del" && o.addr ? `العنوان: ${o.addr}` : "",
    o.mode === "del" && o.loc ? `الموقع: ${o.loc}` : "",
    o.note ? `ملاحظات: ${o.note}` : ""
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

function valid(o) {
  return o && typeof o.id === "string" && o.id.length < 60
    && typeof o.name === "string" && o.name.length < 80
    && typeof o.phone === "string" && o.phone.length < 20
    && Array.isArray(o.items) && o.items.length > 0 && o.items.length < 60
    && o.items.every(i => typeof i.name === "string" && Number.isFinite(i.qty) && Number.isFinite(i.price) && i.qty > 0 && i.qty < 100);
}

app.post("/api/order", async (req, res) => {
  const ip = req.ip, now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 10) return res.status(429).json({ ok: false });
  hits.set(ip, [...recent, now]);

  const o = req.body;
  if (!valid(o)) return res.status(400).json({ ok: false });
  if (seen.has(o.id)) return res.json({ ok: true, duplicate: true });

  o.total = o.items.reduce((s, i) => s + i.price * i.qty, 0);
  try { fs.appendFileSync("orders.jsonl", JSON.stringify({ ...o, receivedAt: new Date().toISOString() }) + "\n"); } catch {}

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: OWNER_PHONE,
        type: "text",
        text: { body: formal(o) }
      })
    });
    if (!r.ok) { console.error("WhatsApp error:", await r.text()); return res.status(502).json({ ok: false }); }
    seen.add(o.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(502).json({ ok: false });
  }
});

app.get("/", (_, res) => res.send("El Bosho backend is running"));
app.listen(PORT, () => console.log("Listening on " + PORT));
