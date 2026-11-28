import Link from "next/link";
import CookieSettingsLink from "./CookieSettingsLink";
import { Logo } from "./ui";
import { DISCLAIMER_FOOTER } from "@/lib/disclaimers";

const legalLinks = [
  { href: "/terms", label: "תקנון ותנאי שימוש" },
  { href: "/privacy", label: "מדיניות פרטיות" },
  { href: "/cookies", label: "מדיניות עוגיות" },
  { href: "/accessibility", label: "הצהרת נגישות" },
];

export default function Footer() {
  return (
    <footer className="bg-bg py-10 border-t border-black/5">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <Logo variant="dark" className="h-7 w-auto mx-auto mb-4 opacity-80" />
        {/* "דיסקליימר ונוסחי טופס" v2 סעיף 1.1 — מילה במילה, בטקסט קריא. */}
        <p className="text-sm text-text leading-relaxed">{DISCLAIMER_FOOTER}</p>

        <nav aria-label="קישורים משפטיים" className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-6">
          {legalLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-xs font-semibold text-text-secondary hover:text-accent underline underline-offset-2"
            >
              {l.label}
            </Link>
          ))}
          <CookieSettingsLink className="inline-flex min-h-11 items-center text-xs font-semibold text-text-secondary hover:text-accent underline underline-offset-2" />
        </nav>

        <p className="text-xs text-text-secondary mt-6">
          פליי אם אר איי בע&quot;מ · ח.פ. 515702637 · <bdi className="whitespace-nowrap">© {new Date().getFullYear()} Fly MRI</bdi>
        </p>
      </div>
    </footer>
  );
}
