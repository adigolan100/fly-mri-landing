import { createHmac, timingSafeEqual } from "node:crypto";

// קוד צד-שרת בלבד (app/api/lead/*). לא לייבא מרכיב לקוח.

/** מזהה ליד: UUID v4 שנוצר בשרת כשהליד נשמר. */
export const LEAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * אסימון שמוכיח שהדפדפן ששולח "כן, שלחו לי" הוא זה שקיבל את מזהה הליד מהשרת.
 * בלעדיו כל אחד יכול היה לרשום הסכמה לליד של מישהו אחר.
 */
export function signLeadId(leadId: string, secret: string): string {
  return createHmac("sha256", `lead-consent:${secret}`).update(leadId).digest("base64url");
}

export function verifyLeadToken(leadId: string, token: string, secret: string): boolean {
  if (!secret || !LEAD_ID_RE.test(leadId) || typeof token !== "string") return false;
  const want = Buffer.from(signLeadId(leadId, secret));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** UTC קריא שגוגל שיטס לא ממיר לתאריך: "2026-11-28 08:15:42 UTC". */
export function utcStamp(d = new Date()): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export type SheetResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; skipped?: boolean; error: string };

/** שליחה ל-Apps Script. Apps Script מחזיר 200 גם בשגיאה — בודקים את גוף התשובה. */
export async function postToSheet(
  url: string,
  secret: string,
  fields: Record<string, string>,
): Promise<SheetResult> {
  if (!url) return { ok: false, skipped: true, error: "not_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, token: secret }).toString(),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `sheet ${res.status}` };
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `sheet non-json: ${text.slice(0, 200)}` };
    }
    if (!body.ok) return { ok: false, error: `sheet: ${String(body.error ?? "unknown")}` };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: `sheet fetch failed: ${(e as Error).message}` };
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** טבלת שדות למייל ההתראה (ערכים כבר מוכנים כ-HTML). */
export function rowsHtml(rows: [string, string][]): string {
  return (
    `<table style="border-collapse:collapse">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${k}</td>` +
          `<td style="padding:6px 12px;font-weight:600">${v}</td></tr>`,
      )
      .join("") +
    `</table>`
  );
}

/** ארבעת שדות ההסכמה כפי שהם מופיעים בגיליון ובמייל. */
export function consentRows(f: Record<string, string>): [string, string][] {
  return [
    ["הסכמה לדיוור", esc(f.marketing_consent || "—")],
    ["מקור ההסכמה", esc(f.consent_source || "—")],
    ["מועד ההסכמה", esc(f.consent_at_utc || "—")],
    ["גרסת נוסח", esc(f.consent_version || "—")],
  ];
}
