"use client";

import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { FORM_CONSENT_TEXT, MAGAZINE } from "@/lib/consent";
import { getAttribution, trackLead } from "@/lib/tracking";
import { Chapter, Container, FocusCircle, Reveal } from "../ui";

const PHONE_RE = /^0\d{1,2}-?\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = { name?: string; phone?: string; email?: string };

/** עוטף מילים לועזיות (Fly MRI, SMS) ב-<bdi> כדי שהפיסוק סביבן לא יקפוץ ב-RTL. */
// טלפון ומייל בהודעת השגיאה — לחיצים (חיוג / מייל).
function ContactLinks({ text }: { text: string }) {
  return (
    <>
      {text.split(/(09-7747905|info@flymri\.com)/).map((part, i) =>
        i % 2 ? (
          <a
            key={i}
            href={part.includes("@") ? `mailto:${part}` : "tel:+97297747905"}
            dir="ltr"
            className="underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Bidi({ text }: { text: string }) {
  return (
    <>
      {text.split(/(Fly MRI|SMS)/).map((part, i) => (i % 2 ? <bdi key={i}>{part}</bdi> : part))}
    </>
  );
}

type MagazineTicket = { leadId: string; token: string };

export default function CTAForm() {
  const c = copy.ctaForm;
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [marketing, setMarketing] = useState(false); // תיבת המגזין — לא מסומנת מראש
  const [errors, setErrors] = useState<FieldErrors>({});
  // חלון המגזין
  const [ticket, setTicket] = useState<MagazineTicket | null>(null);
  const [magOpen, setMagOpen] = useState(false);
  const [magSaving, setMagSaving] = useState(false);
  const [magError, setMagError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // הגנה מהסכמה בטעות: "כן" מגיב רק ללחיצה שהתחילה עליו אחרי שהחלון כבר נראה
  // (לא קליק חוזר על "שולח…" שנוחת על הכפתור ברגע שהחלון קופץ).
  const openedAtRef = useRef(0);
  const yesArmedRef = useRef(false);
  const backdropDownRef = useRef(false);
  const firstName = name.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  // אחרי שליחה הטופס נעלם והפרק מתקצר — מביאים את הודעת התודה למרכז המסך.
  useEffect(() => {
    const el = successRef.current;
    if (!submitted || !el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
  }, [submitted]);

  // חלון המגזין — <dialog> מודאלי: נועל פוקוס בפנים, Escape סוגר, והפוקוס חוזר
  // להודעת התודה בסגירה. (מוצהר אחרי אפקט התודה כדי שהפוקוס יעבור לחלון.)
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (magOpen && !d.open) {
      openedAtRef.current = performance.now();
      yesArmedRef.current = false;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", ""); // דפדפן ישן בלי <dialog> מודאלי
      // פוקוס על הכותרת, לא על "כן" — Enter/רווח לא יירשמו כהסכמה.
      d.querySelector<HTMLElement>("[data-mag=title]")?.focus();
      // נעילת גלילת העמוד מאחור (ScrollMotion עוצר את Lenis כשה-body נעול).
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
    if (!magOpen && d.hasAttribute("open")) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [magOpen]);

  function computeErrors(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "נא למלא שם מלא";
    if (!phone.trim()) next.phone = "נא למלא מספר טלפון";
    else if (!PHONE_RE.test(phone.trim())) next.phone = "מספר הטלפון לא תקין";
    if (!email.trim()) next.email = "נא למלא כתובת אימייל";
    else if (!EMAIL_RE.test(email.trim())) next.email = "כתובת האימייל לא תקינה";
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    const next = computeErrors();
    setErrors(next);
    const firstInvalid = (["name", "phone", "email"] as const).find((k) => next[k]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          marketingConsent: marketing === true,
          company, // honeypot
          ...getAttribution(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: FieldErrors;
        leadId?: string;
        consentToken?: string;
      };

      if (res.ok && body.ok) {
        trackLead(); // אירוע המרה — רק אחרי שהשרת אישר שהליד נשמר
        setSubmitted(true);
        // חלון המגזין: רק אחרי שהבקשה נשמרה, ורק אם התיבה לא סומנה.
        if (!marketing && body.leadId && body.consentToken) {
          setTicket({ leadId: body.leadId, token: body.consentToken });
          setMagOpen(true);
        }
        return;
      }

      if (res.status === 400 && body.fieldErrors) {
        setErrors(body.fieldErrors);
        const f = (["name", "phone", "email"] as const).find((k) => body.fieldErrors?.[k]);
        if (f) document.getElementById(f)?.focus();
        return;
      }

      setSubmitError(
        res.status === 429
          ? "נשלחה כבר פנייה מהמכשיר הזה. אפשר לנסות שוב בעוד רגע."
          : "אירעה תקלה בשליחת הטופס. אפשר לנסות שוב, או ליצור קשר בטלפון 09-7747905 או במייל info@flymri.com.",
      );
    } catch {
      setSubmitError(
        "אירעה תקלה בשליחת הטופס. בדקו את החיבור לאינטרנט ונסו שוב, או צרו קשר בטלפון 09-7747905 או במייל info@flymri.com.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // "לא תודה" / X / Escape / לחיצה מחוץ לחלון — סוגרים. שום דבר לא נשלח.
  function declineMagazine() {
    if (magSaving) return; // "כן" כבר בשליחה — מחכים לתשובה
    setMagOpen(false);
  }

  // "כן, שלחו לי" — הדרך היחידה לרשום הסכמה מהחלון.
  const YES_GUARD_MS = 700;
  async function acceptMagazine(e: MouseEvent) {
    if (!ticket || magSaving) return;
    // לחיצת עכבר/מגע: חייבת להתחיל על הכפתור עצמו, ולא ברגע הראשון של הופעת החלון.
    // (מקלדת — e.detail === 0 — מגיעה רק אחרי מעבר Tab מכוון לכפתור.)
    const tooSoon = performance.now() - openedAtRef.current < YES_GUARD_MS;
    if (tooSoon || (e.detail !== 0 && !yesArmedRef.current)) return;
    setMagSaving(true);
    setMagError(null);
    try {
      const res = await fetch("/api/lead/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: ticket.leadId, token: ticket.token, page: window.location.href }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && body.ok) {
        setMagOpen(false);
        return;
      }
      setMagError("ייתכן שהבחירה לא נשמרה. אפשר לנסות שוב.");
    } catch {
      setMagError("ייתכן שהבחירה לא נשמרה. בדקו את החיבור לאינטרנט ונסו שוב.");
    } finally {
      setMagSaving(false);
    }
  }

  return (
    // overflow-anchor: none — כשהודעות שגיאה מופיעות, הדפדפן לא "מתקן" את
    // הגלילה ומקפיץ את השדה הראשון אל מעל המסך.
    <Chapter id="consult" bg="dark" curveTop className="py-24 sm:py-28 text-white [overflow-anchor:none]">
      <FocusCircle size={280} top="-10%" left="-8%" filled color="45,127,249" />
      <FocusCircle size={200} bottom="-5%" right="-3%" />
      <FocusCircle size={90} top="12%" right="12%" className="hidden sm:block" />
      <Container className="relative max-w-lg">
        {submitted ? (
          // אחרי שליחה: הכותרת "השאירו פרטים" כבר לא רלוונטית — מציגים תודה במקומה.
          <div ref={successRef} tabIndex={-1} role="status" className="text-center outline-none">
            <h2 className="font-heading font-semibold text-2xl sm:text-3xl mb-3 leading-snug">
              {name.split(" ")[0] ? `${name.split(" ")[0]}, ` : ""}
              {c.successHeadline}
            </h2>
            <p className="text-lg opacity-90 leading-relaxed">{c.successBody}</p>
          </div>
        ) : (
        <Reveal>
          <p className="font-latin text-sm font-semibold text-center mb-3" style={{ color: "#DCEEFF" }}>
            {c.headline}
          </p>
          <h2 className="font-heading font-semibold text-2xl sm:text-3xl text-center mb-3 leading-snug">
            {c.formIntro}
          </h2>
        </Reveal>
        )}

        <Reveal>
          {submitted ? null : (
            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
              {submitError && (
                <p
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="rounded-xl px-4 py-3 text-sm font-semibold outline-none"
                  style={{ background: "rgba(255,180,160,0.15)", color: "#FFB4A0" }}
                >
                  <ContactLinks text={submitError} />
                </p>
              )}

              {/* honeypot — נסתר ממשתמשים ומטכנולוגיה מסייעת, נועד לתפוס בוטים */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor="hp-field">אל תמלאו שדה זה</label>
                <input
                  id="hp-field"
                  name="hp-field"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="name" className="block text-sm mb-1.5 opacity-90">
                  שם מלא <span className="opacity-70">(חובה)</span>
                </label>
                <input
                  id="name"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  className="w-full rounded-xl px-4 py-3.5 text-base text-text bg-white/95 outline-none focus:ring-2 focus:ring-cta"
                  dir="rtl"
                />
                {errors.name && (
                  <p id="name-error" role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#FFB4A0" }}>
                    {errors.name}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm mb-1.5 opacity-90">
                  טלפון <span className="opacity-70">(חובה)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  className="w-full rounded-xl px-4 py-3.5 text-base text-text bg-white/95 outline-none focus:ring-2 focus:ring-cta"
                  dir="ltr"
                  style={{ textAlign: "right" }}
                />
                {errors.phone && (
                  <p id="phone-error" role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#FFB4A0" }}>
                    {errors.phone}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="email" className="block text-sm mb-1.5 opacity-90">
                  אימייל <span className="opacity-70">(חובה)</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className="w-full rounded-xl px-4 py-3.5 text-base text-text bg-white/95 outline-none focus:ring-2 focus:ring-cta"
                  dir="ltr"
                  style={{ textAlign: "right" }}
                />
                {errors.email && (
                  <p id="email-error" role="alert" className="mt-1.5 text-sm font-semibold" style={{ color: "#FFB4A0" }}>
                    {errors.email}
                  </p>
                )}
              </div>


              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="marketing-consent"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded bg-white accent-accent"
                />
                {/* 14px ולבן מלא — ניגודיות גבוהה מול הרקע הכהה (לא אפור חיוור). */}
                <label htmlFor="marketing-consent" className="text-sm leading-relaxed text-white">
                  <Bidi text={FORM_CONSENT_TEXT} />
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="w-full rounded-xl font-bold text-lg px-8 py-4 mt-2 disabled:opacity-70"
                style={{
                  background: "var(--cta)",
                  color: "var(--text)",
                  boxShadow: "0 8px 24px rgba(244,142,114,0.35)",
                }}
              >
                {submitting ? "שולח…" : c.ctaText}
              </button>

              <p className="text-xs opacity-70 leading-relaxed">
                בשליחת הטופס אני מאשר/ת ש-Fly MRI תיצור עמי קשר בנוגע לפנייה,{" "}
                <a href="/privacy" className="underline underline-offset-2">
                  בהתאם למדיניות הפרטיות
                </a>
                .
              </p>
            </form>
          )}
        </Reveal>

        <Reveal>
          <p className="text-xs opacity-70 leading-relaxed mt-6 text-center max-w-md mx-auto">
            {c.disclaimer}
          </p>
        </Reveal>
      </Container>

      <dialog
        ref={dialogRef}
        data-lenis-prevent
        aria-labelledby="magazine-title"
        aria-describedby="magazine-body"
        // Escape סוגר את החלון (התנהגות הדפדפן) — מסנכרנים את המצב. לא נשלח דבר.
        onClose={() => setMagOpen(false)}
        onCancel={(e) => {
          if (magSaving) e.preventDefault();
        }}
        // לחיצה על הרקע (מחוץ לתוכן) = "לא תודה" — רק אם גם הלחיצה התחילה מחוץ לחלון
        // (גרירת סימון טקסט החוצה או לחיצה על פס הגלילה לא נחשבות).
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
          backdropDownRef.current = e.target === e.currentTarget && outside;
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
          if (e.target === e.currentTarget && outside && backdropDownRef.current) declineMagazine();
          backdropDownRef.current = false;
        }}
        className="magazine-dialog m-auto max-h-[calc(100dvh-1.5rem)] w-[min(92vw,24rem)] overflow-y-auto rounded-2xl p-0 text-start"
        style={{ background: "var(--white)", color: "var(--text)", boxShadow: "0 12px 40px rgba(12,32,44,0.22)" }}
      >
        <div className="relative p-5" dir="rtl">
          <button
            type="button"
            onClick={declineMagazine}
            disabled={magSaving}
            aria-label={MAGAZINE.close}
            className="absolute end-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg aria-hidden width="15" height="15" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <p data-mag="confirm" className="flex items-center gap-1.5 pe-10 text-sm font-semibold" style={{ color: "#1F7A4D" }}>
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {MAGAZINE.confirm}
          </p>

          {/* הפוקוס הראשוני על הכותרת ולא על "כן" — כדי ש-Enter כפול לא יירשם כהסכמה. */}
          <h3
            id="magazine-title"
            data-mag="title"
            tabIndex={-1}
            className="font-heading mt-3 text-lg font-semibold leading-snug outline-none [text-wrap:balance]"
          >
            {MAGAZINE.title(firstName)}
          </h3>
          <div id="magazine-body">
            <p data-mag="body" className="mt-2 text-[0.95rem] leading-relaxed">
              <Bidi text={MAGAZINE.body} />
            </p>
            <p data-mag="teaser" className="mt-2 text-[0.95rem] leading-relaxed">
              {MAGAZINE.teaserLead}
              <strong className="font-semibold">{MAGAZINE.teaserTitle}</strong>
            </p>
            <p data-mag="disclosure" className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              <Bidi text={MAGAZINE.disclosure} />
            </p>
          </div>

          {magError && (
            <p role="alert" className="mt-3 text-sm font-semibold" style={{ color: "#B3261E" }}>
              {magError}
            </p>
          )}

          <button
            type="button"
            data-mag="yes"
            onPointerDown={() => {
              yesArmedRef.current = performance.now() - openedAtRef.current >= YES_GUARD_MS;
            }}
            onClick={acceptMagazine}
            disabled={magSaving}
            aria-busy={magSaving}
            className="mt-4 w-full rounded-xl px-4 py-3 text-base font-bold disabled:opacity-70"
            style={{ background: "var(--cta)", color: "var(--text)" }}
          >
            {magSaving ? "שולח…" : MAGAZINE.yes}
          </button>
          <button
            type="button"
            data-mag="no"
            onClick={declineMagazine}
            disabled={magSaving}
            className="mt-1 flex min-h-11 w-full items-center justify-center text-sm underline underline-offset-4"
            style={{ color: "var(--text-secondary)" }}
          >
            {MAGAZINE.no}
          </button>
        </div>
      </dialog>
    </Chapter>
  );
}
