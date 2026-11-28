import type { NextRequest } from "next/server";
import { CONSENT_CHANNELS, CONSENT_SOURCE, CONSENT_VERSION } from "@/lib/consent";
import { consentRows, esc, postToSheet, rowsHtml, utcStamp, verifyLeadToken } from "@/lib/leadBackend";

// ── רישום הסכמה לדיוור מחלון המגזין ──
// נקרא רק מלחיצה על "כן, עדכנו אותי", אחרי שבקשת הייעוץ כבר נשמרה. מעדכן את שורת הליד
// בגיליון (לפי מזהה הליד), מוסיף שורה ליומן ההסכמות, ושולח מייל עדכון קצר.
// "לא תודה" / X / Escape / לחיצה מחוץ לחלון לא קוראים לכאן בכלל.

const SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL ?? "";
const SHEETS_SECRET = process.env.SHEETS_SECRET ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const LEAD_NOTIFY_TO = (process.env.LEAD_NOTIFY_TO ?? "info@flymri.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LEAD_NOTIFY_FROM = process.env.LEAD_NOTIFY_FROM ?? "FLY MRI לידים <leads@updates.flymri.com>";
const LEADS_SHEET_URL = process.env.LEADS_SHEET_URL ?? "";

type Payload = { leadId?: unknown; token?: unknown; page?: unknown };

async function sendConsentEmail(f: Record<string, string>) {
  if (!RESEND_API_KEY) return { ok: false, skipped: true };
  const html =
    `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">` +
    `<h2 style="margin:0 0 12px">עדכון: ${esc(f.name || "ליד")} אישר/ה קבלת עדכונים</h2>` +
    rowsHtml([
      ["שם", esc(f.name || "—")],
      ["טלפון", esc(f.phone || "—")],
      ["אימייל", esc(f.email || "—")],
      ...consentRows(f),
      ["עמוד", esc(f.page || "—")],
      ["מזהה ליד", esc(f.lead_id)],
    ]) +
    (LEADS_SHEET_URL ? `<p style="margin-top:16px"><a href="${esc(LEADS_SHEET_URL)}">פתיחת גיליון הלידים</a></p>` : "") +
    `</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: LEAD_NOTIFY_FROM,
        to: LEAD_NOTIFY_TO,
        subject: `עדכון: ${f.name || "ליד"} אישר/ה קבלת עדכונים`,
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

  const leadId = typeof data.leadId === "string" ? data.leadId : "";
  const token = typeof data.token === "string" ? data.token : "";
  if (!verifyLeadToken(leadId, token, SHEETS_SECRET)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const fields: Record<string, string> = {
    action: "consent",
    lead_id: leadId,
    marketing_consent: "כן",
    consent_source: CONSENT_SOURCE.popup,
    consent_at_utc: utcStamp(),
    consent_version: CONSENT_VERSION,
    consent_channels: CONSENT_CHANNELS,
    page: typeof data.page === "string" ? data.page.slice(0, 500) : "",
  };

  const sheet = await postToSheet(SHEETS_WEBAPP_URL, SHEETS_SECRET, fields);
  // הסקריפט הישן (גרסה 1) מוסיף כל בקשה כשורת ליד חדשה ועונה ok — לא לסמוך על זה.
  // רק גרסה 2 ומעלה, שמחזירה את פרטי הליד שעודכן, נחשבת הצלחה.
  if (sheet.ok && !(Number(sheet.body.v) >= 2 && sheet.body.lead)) {
    console.error("[lead/consent] Apps Script is not v2 — redeploy google-apps-script/Code.gs", sheet.body);
    return Response.json({ ok: false, error: "backend_outdated" }, { status: 502 });
  }
  if (!sheet.ok) {
    console.error("[lead/consent] not stored", sheet);
    return Response.json({ ok: false, error: "storage_failed" }, { status: 502 });
  }

  // כבר אישר קודם (לחיצה כפולה / ניסיון חוזר) — לא שולחים מייל שוב.
  if (!sheet.body.already) {
    const lead = (sheet.body.lead ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
    const mail = await sendConsentEmail({
      ...fields,
      name: str(lead.name),
      phone: str(lead.phone),
      email: str(lead.email),
    });
    if (!mail.ok && !("skipped" in mail && mail.skipped)) {
      console.warn("[lead/consent] stored, but update email not sent", mail);
    }
  }

  return Response.json({ ok: true });
}

export function GET() {
  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
