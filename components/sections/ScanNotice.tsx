import { DISCLAIMER_SCAN, DISCLAIMER_SCAN_TITLE } from "@/lib/disclaimers";
import { Chapter, Container, Reveal } from "../ui";

/** "דיסקליימר ונוסחי טופס" v2 סעיף 1.3 — "מה חשוב לדעת", מילה במילה, בכל עמוד שמתאר את הבדיקה. */
export default function ScanNotice() {
  return (
    <Chapter bg="bg" curveTop className="py-16 sm:py-20">
      <Container>
        <Reveal>
          <h2 className="font-heading font-bold text-2xl sm:text-3xl text-text mb-4 leading-snug">
            {DISCLAIMER_SCAN_TITLE}
          </h2>
          <p className="text-base sm:text-lg leading-relaxed text-text">{DISCLAIMER_SCAN}</p>
        </Reveal>
      </Container>
    </Chapter>
  );
}
