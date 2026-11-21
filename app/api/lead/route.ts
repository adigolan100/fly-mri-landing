import type { NextRequest } from "next/server";

// ── יעד הלידים: Google Sheet בדרייב של FLY + מייל התראה, דרך Apps Script Web App ──
// הקוד של הסקריפט: google-apps-script/Code.gs. כתובת ה-/exec של הפריסה (הרשאה: Anyone).
// SHEETS_SECRET חייב להיות זהה ל-LEAD_SECRET ב-Script Properties של הסקריפט.
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL ?? "";
const SHEETS_SECRET = process.env.SHEETS_SECRET ?? "";

const PHONE_RE = /^0\d{1,2}-?\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// הגבלת קצב בסיסית (best-effort; בסביבת serverless זה per-instance).
// להגנה אמיתית מומלץ Upstash/Vercel KV.
const RATE_LIMIT_MS = 15_000;
const lastSeen = new Map<string, number>();

type Payload = {
  name?: string;
  phone?: string;
  email?: string;
  marketingConsent?: boolean;
  page?: string;
  landingPage?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  msclkid?: string;
  ttclid?: string;
  lastUtmSource?: string;
  lastUtmMedium?: string;
  lastUtmCampaign?: string;
  company?: string; // honeypot — אמור להישאר ריק
};

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

async function sendToSheet(fields: Record<string, string>) {
  if (!SHEETS_WEBAPP_URL) return { ok: false, skipped: true };
  try {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, token: SHEETS_SECRET }).toString(),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `sheet ${res.status}` };
    // Apps Script מחזיר 200 גם בשגיאה — בודקים את גוף התשובה.
    const text = await res.text();
    let body: { ok?: boolean; error?: string; mail?: boolean } = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `sheet non-json: ${text.slice(0, 200)}` };
    }
    if (!body.ok) return { ok: false, error: `sheet: ${body.error ?? "unknown"}` };
    if (body.mail === false) console.warn("[lead] stored in sheet but email failed");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `sheet fetch failed: ${(e as Error).message}` };
  }
}

export async function POST(request: NextRequest) {
  let data: Payload;
  try {
    data = (await request.json()) as Payload;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Honeypot — בוט מילא שדה נסתר. מחזירים הצלחה שקטה ולא שומרים.
  if (data.company && data.company.trim() !== "") {
    return Response.json({ ok: true });
  }

  const name = (data.name ?? "").trim();
  const phone = (data.phone ?? "").trim();
  const email = (data.email ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "נא למלא שם מלא";
  if (!phone) fieldErrors.phone = "נא למלא מספר טלפון";
  else if (!PHONE_RE.test(phone)) fieldErrors.phone = "מספר הטלפון לא תקין";
  if (!email) fieldErrors.email = "נא למלא כתובת אימייל";
  else if (!EMAIL_RE.test(email)) fieldErrors.email = "כתובת האימייל לא תקינה";
  if (Object.keys(fieldErrors).length > 0) {
    return Response.json({ ok: false, error: "validation", fieldErrors }, { status: 400 });
  }

  const ip = clientIp(request);
  const now = Date.now();
  const prev = lastSeen.get(ip) ?? 0;
  if (now - prev < RATE_LIMIT_MS) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  lastSeen.set(ip, now);

  const marketingConsent = data.marketingConsent === true;
  const consentAt = new Date().toISOString();
  const userAgent = request.headers.get("user-agent") ?? "";
  const clip = (v: string | undefined, n: number) => (v ?? "").slice(0, n);
  const page = clip(data.page, 500);
  const landingPage = clip(data.landingPage, 500);
  const referrer = clip(data.referrer, 500);
  const utmSource = clip(data.utmSource, 200);
  const utmMedium = clip(data.utmMedium, 200);
  const utmCampaign = clip(data.utmCampaign, 200);
  const utmTerm = clip(data.utmTerm, 200);
  const utmContent = clip(data.utmContent, 200);
  const gclid = clip(data.gclid, 300);
  const gbraid = clip(data.gbraid, 300);
  const wbraid = clip(data.wbraid, 300);
  const fbclid = clip(data.fbclid, 300);
  const msclkid = clip(data.msclkid, 300);
  const ttclid = clip(data.ttclid, 300);
  const lastUtmSource = clip(data.lastUtmSource, 200);
  const lastUtmMedium = clip(data.lastUtmMedium, 200);
  const lastUtmCampaign = clip(data.lastUtmCampaign, 200);

  const sheetFields: Record<string, string> = {
    name,
    phone,
    email,
    page,
    landing_page: landingPage,
    referrer,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_term: utmTerm,
    utm_content: utmContent,
    gclid,
    gbraid,
    wbraid,
    fbclid,
    msclkid,
    ttclid,
    last_utm_source: lastUtmSource,
    last_utm_medium: lastUtmMedium,
    last_utm_campaign: lastUtmCampaign,
    marketing_consent: marketingConsent ? "כן" : "לא",
    consent_at: consentAt,
    ip,
    user_agent: userAgent,
  };

  const sheet = await sendToSheet(sheetFields);

  if (!sheet.ok) {
    // הליד לא נשמר — מחזירים שגיאה אמיתית כדי שהטופס יציג הודעת כשל.
    console.error("[lead] not stored", sheet);
    return Response.json(
      { ok: false, error: sheet.skipped ? "backend_not_configured" : "storage_failed" },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
