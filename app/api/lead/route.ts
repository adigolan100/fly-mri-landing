import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { CONSENT_CHANNELS, CONSENT_SOURCE, CONSENT_VERSION } from "@/lib/consent";
import { consentRows, signLeadId, utcStamp } from "@/lib/leadBackend";

// ── יעד הלידים: Google Sheet בדרייב של FLY + מייל התראה, דרך Apps Script Web App ──
// הקוד של הסקריפט: google-apps-script/Code.gs. כתובת ה-/exec של הפריסה (הרשאה: Anyone).
// SHEETS_SECRET חייב להיות זהה ל-LEAD_SECRET ב-Script Properties של הסקריפט.
const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL ?? "";
const SHEETS_SECRET = process.env.SHEETS_SECRET ?? "";

// ── מייל התראה על כל ליד — Resend (דומיין שולח מאומת: updates.flymri.com) ──
// נשלח מהשרת אחרי שהליד נשמר בגיליון. כשל במייל לא מכשיל את הליד.
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const LEAD_NOTIFY_TO = (process.env.LEAD_NOTIFY_TO ?? "info@flymri.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LEAD_NOTIFY_FROM = process.env.LEAD_NOTIFY_FROM ?? "FLY MRI לידים <leads@updates.flymri.com>";
const LEADS_SHEET_URL = process.env.LEADS_SHEET_URL ?? "";
// מקור הליד בכותרת המייל — מבדיל בין האתר הראשי לדף הנחיתה.
const SOURCE_LABEL = "מדף הנחיתה";

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
    if ((body as { log?: boolean }).log === false) console.error("[lead] stored, but consent log row NOT written — check the הסכמות tab");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `sheet fetch failed: ${(e as Error).message}` };
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

async function sendLeadEmail(f: Record<string, string>, notStored = false) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true };
  const intlPhone = f.phone.replace(/\D/g, "").replace(/^0/, "972");
  const source =
    [f.utm_source, f.utm_medium, f.utm_campaign].filter(Boolean).join(" / ") || "כניסה ישירה / לא ידוע";
  const rows: [string, string][] = [
    ["שם", esc(f.name)],
    [
      "טלפון",
      `<a href="tel:${esc(f.phone)}">${esc(f.phone)}</a>` +
        (intlPhone ? ` &nbsp;·&nbsp; <a href="https://wa.me/${intlPhone}">וואטסאפ</a>` : ""),
    ],
    ["אימייל", f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : "—"],
    ["מקור", esc(source)],
    ...consentRows(f),
    ["עמוד", esc(f.page || "—")],
  ];
  const html =
    `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">` +
    `<h2 style="margin:0 0 12px">ליד חדש ${SOURCE_LABEL}</h2>` +
    (notStored
      ? `<p style="margin:0 0 12px;color:#B3261E;font-weight:bold">⚠️ הליד לא נשמר בגיליון (תקלה בגוגל). יש להעתיק אותו ידנית.</p>`
      : "") +
    `<table style="border-collapse:collapse">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${k}</td>` +
          `<td style="padding:6px 12px;font-weight:600">${v}</td></tr>`,
      )
      .join("") +
    `</table>` +
    (LEADS_SHEET_URL ? `<p style="margin-top:16px"><a href="${esc(LEADS_SHEET_URL)}">פתיחת גיליון הלידים</a></p>` : "") +
    `</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: LEAD_NOTIFY_FROM,
        to: LEAD_NOTIFY_TO,
        reply_to: f.email || undefined,
        subject: `${notStored ? "⚠️ לא נשמר בגיליון — " : ""}ליד חדש ${SOURCE_LABEL}: ${f.name}${f.phone ? ` · ${f.phone}` : ""}`,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `resend fetch failed: ${(e as Error).message}` };
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
  if (String(data.company ?? "").trim() !== "") {
    console.warn("[lead] honeypot filled — not stored");
    return Response.json({ ok: true });
  }

  const name = String(data.name ?? "").trim().slice(0, 200);
  const phone = String(data.phone ?? "").trim().slice(0, 40);
  const email = String(data.email ?? "").trim().slice(0, 320);

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
  // נרשם רק אחרי שהליד נשמר (למטה) — כך ניסיון חוזר אחרי כשל אחסון לא ייחסם.

  // הסכמה נרשמת רק מסימון פעיל בתיבה (true בוליאני) — כל ערך אחר = אין הסכמה.
  const marketingConsent = data.marketingConsent === true;
  const leadId = randomUUID();
  const consentAt = new Date().toISOString();
  const userAgent = request.headers.get("user-agent") ?? "";
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v : "").slice(0, n);
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
    // ארבעה שדות חדשים בסוף השורה (מקור / מועד UTC / גרסה / מזהה ליד).
    // ערוצים — ליומן ההסכמות בלבד.
    consent_source: marketingConsent ? CONSENT_SOURCE.form : "",
    consent_at_utc: marketingConsent ? utcStamp() : "",
    consent_version: marketingConsent ? CONSENT_VERSION : "",
    consent_channels: marketingConsent ? CONSENT_CHANNELS : "",
    lead_id: leadId,
    consent_at: consentAt,
    ip,
    user_agent: userAgent,
  };

  const sheet = await sendToSheet(sheetFields);

  if (!sheet.ok) {
    // הליד לא נשמר — מחזירים שגיאה אמיתית כדי שהטופס יציג הודעת כשל.
    console.error("[lead] not stored", sheet);
    // שלא ילך לאיבוד: המייל נשלח בכל זאת, מסומן "לא נשמר בגיליון".
    if (!sheet.skipped) {
      const mail = await sendLeadEmail(sheetFields, true);
      if (!mail.ok) console.error("[lead] NOT stored and email failed too", mail);
    }
    return Response.json(
      { ok: false, error: sheet.skipped ? "backend_not_configured" : "storage_failed" },
      { status: 502 },
    );
  }

  lastSeen.set(ip, Date.now());

  // הליד כבר שמור — המייל הוא תוספת. כשל נרשם בלוג בלבד.
  const mail = await sendLeadEmail(sheetFields);
  if (!mail.ok) console.warn("[lead] stored, but notification email not sent", mail);

  // מזהה הליד + אסימון חתום — מאפשרים לחלון המגזין לרשום הסכמה לליד הזה בלבד.
  return Response.json({ ok: true, leadId, consentToken: signLeadId(leadId, SHEETS_SECRET) });
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
