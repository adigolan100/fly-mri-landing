"use client";

// ── תנועת גלילה בסגנון prenuvo.com ─────────────────────────────────────────
// 1. פרקים נערמים: כל <section> ישיר בתוך <main> מסומן data-stack-panel,
//    מקבל position: sticky ו-z-index עולה, והפרק הבא "עולה" מעליו. הפרק
//    האחרון נשאר relative. top = min(header, viewport - bottom - height),
//    כך שפרק גבוה מהמסך נגלל עד סופו לפני שהוא נעצר.
// 2. עומק: כשהפרק הבא עולה, הפרק שמתחת מתכווץ (0.96) ומתעמעם (מ-768px).
// 3. גלילה רכה (Lenis) + פרלקסה עדינה לתמונות [data-parallax] (GSAP).
//
// בלי JS: הכול נגלל רגיל. prefers-reduced-motion: בלי Lenis ובלי אנימציות —
// ההיערמות נשארת. נטען מחדש בכל מעבר עמוד (pathname בתלויות).

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import "lenis/dist/lenis.css";

type LenisT = import("lenis").default;
type GsapT = typeof import("gsap").default;
type STT = typeof import("gsap/ScrollTrigger").ScrollTrigger;

const PANEL_SELECTOR = "#main-content > section";
const SCALE_TO = 0.96;
const DIM_TO = 0.7;
/** מרווח נוסף בתחתית כל פרק (~2 ס״מ), כדי שהפרק הבא לא יעלה על התוכן מהר מדי. */
const BOTTOM_ROOM = 76;
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** מרחק אלמנט מראש המסמך, בלי השפעת transform/sticky (סכום offsetTop). */
function docTop(el: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y;
}

/** מחכה שהדפדפן יסיים גלילה משלו (שחזור מיקום / קפיצה לטקסט): 150ms שקט, עד 3 שניות. */
function whenScrollSettles(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      window.removeEventListener("scroll", onScroll);
      resolve();
    };
    const onScroll = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, 150);
    };
    const cap = setTimeout(done, 3000);
    quiet = setTimeout(done, 150);
    window.addEventListener("scroll", onScroll, { passive: true });
    signal.addEventListener("abort", done);
  });
}

// מצב ניווט ברמת המודול: איזה עמוד הוצג קודם, והאם הגענו אליו ב-Back/Forward.
let lastPath: string | null = null;
let historyPath: string | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    historyPath = location.pathname;
  });
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(REDUCE_QUERY);
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

export default function ScrollMotion() {
  const pathname = usePathname();
  const reduceState = useReducedMotion();

  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const html = document.documentElement;
    const reduce = window.matchMedia(REDUCE_QUERY).matches;
    const ac = new AbortController();
    const { signal } = ac;
    const cleanups: Array<() => void> = [];

    // מלכודת 2: במעבר עמוד — מתחילים מלמעלה (אלא אם יש #, או Back/Forward).
    // משווים ל-pathname הקודם, כך שהרצה כפולה של אותו עמוד (StrictMode,
    // שינוי הגדרת הפחתת תנועה) לא מקפיצה לראש העמוד.
    const fromHistory = historyPath === pathname;
    const isInitial = lastPath === null;
    historyPath = null;
    if (lastPath !== null && lastPath !== pathname && !location.hash && !fromHistory) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    lastPath = pathname;

    // ── מדידות ────────────────────────────────────────────────────────────
    let panels: HTMLElement[] = [];
    let nat: number[] = []; // מיקום טבעי (לא נעוץ) של כל פרק
    let heights: number[] = [];
    let stickTop: number[] = [];
    let headerH = 0;
    let bottomBarH = 0;

    const visibleHeight = (el: Element | null) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.height > 0 && getComputedStyle(el).display !== "none" ? r.height : 0;
    };

    /** גובה המכשולים בתחתית: פס ה-CTA בטלפון, או באנר העוגיות כשהוא פתוח. */
    const bottomObstruction = () =>
      Math.max(bottomBarH, parseFloat(html.style.scrollPaddingBottom) || 0);

    const measure = () => {
      headerH = visibleHeight(document.querySelector("body > header"));
      bottomBarH = visibleHeight(document.querySelector("[data-bottom-bar]"));
      html.style.setProperty("--header-h", `${headerH}px`);
      panels = Array.from(main.querySelectorAll<HTMLElement>(PANEL_SELECTOR));
      // מודדים את המיקום הטבעי: משחררים זמנית את ה-sticky.
      const lastIdx = panels.length - 1;
      panels.forEach((p, i) => {
        p.style.position = "relative";
        p.style.top = "";
        // קוראים את הריפוד המקורי בלי מעבר CSS (במצב הפחתת תנועה לכל אלמנט יש
        // transition קצרצר, והקריאה הייתה מחזירה ערך ישן — והריפוד היה גדל בלולאה).
        p.style.transition = "none";
        p.style.paddingBottom = "";
        // לא במסך הפתיחה: שם הריפוד היה מזיז את הכותרת והתמונה למעלה.
        if (i > 0 && i < lastIdx) {
          const pb = parseFloat(getComputedStyle(p).paddingBottom) || 0;
          p.style.paddingBottom = `${pb + BOTTOM_ROOM}px`;
        }
        p.style.transition = "";
      });
      nat = panels.map(docTop);
      heights = panels.map((p) => p.offsetHeight);
      const last = panels.length - 1;
      const bottom = bottomObstruction();
      stickTop = panels.map((_, i) => Math.min(headerH, window.innerHeight - bottom - heights[i]));
      panels.forEach((p, i) => {
        p.dataset.stackPanel = "";
        p.style.zIndex = String(i + 1);
        if (i < last) {
          p.style.position = "sticky";
          p.style.top = `${stickTop[i]}px`;
        }
      });
    };

    const resetPanels = () => {
      for (const p of panels) {
        delete p.dataset.stackPanel;
        p.style.position = "";
        p.style.top = "";
        p.style.zIndex = "";
        p.style.paddingBottom = "";
      }
      html.style.removeProperty("--header-h");
    };

    /** נקודת הגלילה האחרונה שבה הפרק עוד לא מכוסה ע"י הפרק הבא. */
    const coverStart = (i: number) =>
      i < panels.length - 1 ? nat[i] - stickTop[i] : Number.POSITIVE_INFINITY;

    /** לאן לגלול כדי שאלמנט בתוך פרק יראה במלואו — בלי לחצות את הנקודה שבה הבא מכסה. */
    const targetY = (el: HTMLElement): number | null => {
      const panel = el.closest<HTMLElement>("[data-stack-panel]");
      const i = panel ? panels.indexOf(panel) : -1;
      if (!panel || i < 0) return null;
      let within = 0;
      for (let n: HTMLElement | null = el; n && n !== panel; n = n.offsetParent as HTMLElement | null) {
        if (!panel.contains(n)) break;
        within += n.offsetTop;
      }
      const elTop = nat[i] + within;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      const topPad = Math.max(headerH + 12, margin);
      let y = Math.min(elTop - topPad, coverStart(i));
      const bottom = bottomObstruction();
      const band = window.innerHeight - bottom - topPad;
      // אלמנט שגבוה מהשטח הפנוי מיושר לראשו; אחרת מוודאים שגם התחתית גלויה.
      if (el.offsetHeight <= band) {
        const needBottom = elTop + el.offsetHeight - (window.innerHeight - bottom - 12);
        if (y < needBottom) y = Math.min(needBottom, coverStart(i));
      }
      return Math.max(0, y);
    };

    measure();
    cleanups.push(resetPanels);

    // קישור עם # (למשל /#consult): measure מוסיף מרווח בתחתית הפרקים ומזיז את
    // היעד אחרי שהדפדפן כבר קפץ אליו — מיישרים מחדש. לא אם המשתמש כבר גלל.
    let userMoved = false;
    const onUserInput = () => {
      userMoved = true;
    };
    for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"] as const)
      window.addEventListener(ev, onUserInput, { passive: true, once: true });
    cleanups.push(() => {
      for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"] as const)
        window.removeEventListener(ev, onUserInput);
    });
    const alignHash = () => {
      if (!location.hash || userMoved || fromHistory) return;
      let id = location.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {}
      const target = document.getElementById(id);
      if (!target) return;
      const y =
        targetY(target) ??
        docTop(target) - Math.max(headerH, parseFloat(getComputedStyle(target).scrollMarginTop) || 0);
      window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
    };
    if (isInitial || location.hash) alignHash();

    let lenis: LenisT | null = null;
    const scrollToY = (y: number, smooth: boolean) => {
      if (lenis) lenis.scrollTo(y, { immediate: !smooth, force: true });
      else window.scrollTo({ top: y, behavior: smooth && !reduce ? "smooth" : "instant" });
    };

    // ── מקלדת (מלכודת 5): Tab לא נוחת על אלמנט מוסתר ───────────────────────
    // רק פוקוס מהמקלדת. שדות טקסט תמיד :focus-visible גם בלחיצה, לכן
    // מזהים לחיצת עכבר/מגע ישירות.
    let pointerAt = -Infinity;
    const onPointerDown = () => {
      pointerAt = performance.now();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    cleanups.push(() => document.removeEventListener("pointerdown", onPointerDown, true));

    const isHidden = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.top < headerH || r.bottom > window.innerHeight - bottomObstruction()) return true;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
      for (const y of [r.top + 2, r.bottom - 2]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          // חפיפה בתוך אותו פרק היא חלק מהעיצוב המקורי — לא הסתרה.
          if (hit.closest("[data-stack-panel]") !== el.closest("[data-stack-panel]")) return true;
        }
      }
      return false;
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === main || el.matches(PANEL_SELECTOR)) return;
      if (!el.closest("[data-stack-panel]")) return;
      if (el.closest("dialog[open]")) return; // פוקוס בתוך חלון פתוח — לא לגלול את העמוד מאחור
      if (performance.now() - pointerAt < 800) return;
      let visible = false;
      try {
        visible = el.matches(":focus-visible");
      } catch {}
      if (!visible) return;
      requestAnimationFrame(() => {
        if (!isHidden(el)) return;
        const y = targetY(el);
        if (y !== null) scrollToY(y, false);
      });
    };
    document.addEventListener("focusin", onFocusIn);
    cleanups.push(() => document.removeEventListener("focusin", onFocusIn));

    // ── קישורי עוגן באותו עמוד: למיקום הטבעי, מתחת ל-header ─────────────────
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      let id = url.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {}
      const target = document.getElementById(id);
      if (!target) return;
      const y =
        targetY(target) ??
        docTop(target) - Math.max(headerH, parseFloat(getComputedStyle(target).scrollMarginTop) || 0);
      e.preventDefault();
      if (url.hash !== location.hash) history.pushState(history.state, "", url.hash);
      scrollToY(Math.max(0, y), true);
      if (target.hasAttribute("tabindex")) target.focus({ preventScroll: true });
    };
    document.addEventListener("click", onClick, true);
    cleanups.push(() => document.removeEventListener("click", onClick, true));

    // ── עדכון מדידות: תוכן משנה גובה / חלון משנה רוחב / פרקים מתחלפים ───────
    // אחרי ש-GSAP עולה, ScrollTrigger מנהל את ה-resize בעצמו (כולל התעלמות
    // משינויי גובה של סרגל הכתובת בטלפון), ו-refresh מפעיל measure.
    let refresh = () => measure();
    let rebuild = () => {};
    let t: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => refresh(), 120);
    };
    const ro = new ResizeObserver(schedule);
    const observeAll = () => {
      ro.disconnect();
      ro.observe(main);
      panels.forEach((p) => ro.observe(p));
    };
    observeAll();
    const mo = new MutationObserver(() => {
      resetPanels();
      measure();
      observeAll();
      rebuild();
    });
    mo.observe(main, { childList: true });
    // באנר העוגיות משנה את scroll-padding-bottom של <html> — הפרקים נעצרים מעליו.
    const htmlMo = new MutationObserver(schedule);
    htmlMo.observe(html, { attributes: true, attributeFilter: ["style"] });
    let lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW && lenis) return; // ScrollTrigger מטפל
      lastW = window.innerWidth;
      schedule();
    };
    window.addEventListener("resize", onResize);
    cleanups.push(() => {
      clearTimeout(t);
      ro.disconnect();
      mo.disconnect();
      htmlMo.disconnect();
      window.removeEventListener("resize", onResize);
    });

    // ── Lenis + GSAP — רק אחרי שהדפדפן סיים גלילה משלו (מלכודת 3) ────────────
    (async () => {
      await whenScrollSettles(signal);
      if (signal.aborted) return;
      alignHash();
      if (reduce) return;
      const [{ default: gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("lenis"),
      ]);
      if (signal.aborted) return;
      gsap.registerPlugin(ScrollTrigger);

      const l = new Lenis({ autoRaf: false, anchors: false });
      lenis = l;
      l.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => l.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      // תפריט הטלפון נועל את הגלילה (body overflow: hidden) — עוצרים גם את Lenis,
      // כדי שגלגלת העכבר תגלול את התפריט ולא את העמוד שמאחוריו.
      const syncLock = () => {
        if (document.body.style.overflow === "hidden") l.stop();
        else l.start();
      };
      const bodyMo = new MutationObserver(syncLock);
      bodyMo.observe(document.body, { attributes: true, attributeFilter: ["style"] });
      syncLock();

      ScrollTrigger.addEventListener("refreshInit", measure);
      refresh = () => ScrollTrigger.refresh();

      let mm = buildTweens(gsap, ScrollTrigger);
      rebuild = () => {
        mm.revert();
        mm = buildTweens(gsap, ScrollTrigger);
      };

      cleanups.push(() => {
        mm.revert();
        bodyMo.disconnect();
        ScrollTrigger.removeEventListener("refreshInit", measure);
        gsap.ticker.remove(tick);
        l.destroy();
        lenis = null;
        rebuild = () => {};
      });
    })();

    function buildTweens(gsap: GsapT, ScrollTrigger: STT) {
      const mm = gsap.matchMedia();
      mm.add({ desktop: "(min-width: 768px)", mobile: "(max-width: 767.98px)" }, (ctx) => {
        const dim = Boolean(ctx.conditions?.desktop);
        const last = panels.length - 1;
        panels.forEach((panel, i) => {
          const next = i < last ? i + 1 : -1;
          // תמונות רקע: פרלקסה עדינה מכניסת הפרק למסך עד שהוא מכוסה/יוצא.
          panel.querySelectorAll<HTMLElement>("[data-parallax]").forEach((img) => {
            gsap.fromTo(
              img,
              // מתחילים במסגור המקורי (בלי זום), ומשם התמונה יורדת ומתקרבת קלות.
              // 4% תזוזה < 5% שוליים שנוצרים מ-scale 1.1 — אין חור בקצה.
              { yPercent: 0, scale: 1 },
              {
                yPercent: 4,
                scale: 1.1,
                ease: "none",
                scrollTrigger: {
                  start: () => Math.max(0, nat[i] - window.innerHeight),
                  end: () => (next > 0 ? nat[next] - headerH : nat[i] + heights[i]),
                  scrub: true,
                  invalidateOnRefresh: true,
                },
              },
            );
          });
          if (next < 0) return;
          // עומק: הפרק מתכווץ ומתעמעם בזמן שהבא עולה עליו. במנוחה (התקדמות 0)
          // מנקים את ה-transform/filter, כדי לא להשאיר שכבה מיותרת על הפרק.
          const start = () => Math.max(0, nat[next] - window.innerHeight);
          const clear = () => gsap.set(panel, { clearProps: "transform,filter,transformOrigin" });
          gsap.fromTo(
            panel,
            dim ? { scale: 1, filter: "brightness(1)" } : { scale: 1 },
            {
              scale: SCALE_TO,
              ...(dim ? { filter: `brightness(${DIM_TO})` } : {}),
              ease: "none",
              immediateRender: false,
              transformOrigin: () => `50% ${window.innerHeight / 2 - stickTop[i]}px`,
              scrollTrigger: {
                start,
                end: () => Math.max(nat[next] - headerH, start() + 1),
                scrub: true,
                invalidateOnRefresh: true,
                onLeaveBack: clear,
              },
            },
          );
        });
        return () => {
          panels.forEach((p) => gsap.set(p, { clearProps: "transform,filter,transformOrigin" }));
        };
      });
      ScrollTrigger.refresh();
      return mm;
    }

    return () => {
      ac.abort();
      for (const fn of cleanups.reverse()) fn();
    };
  }, [pathname, reduceState]);

  return null;
}
