import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Hero from "@/components/sections/Hero";
import Knowledge from "@/components/sections/Knowledge";
import Care from "@/components/sections/Care";
import CTAForm from "@/components/sections/CTAForm";
import ScanNotice from "@/components/sections/ScanNotice";
import ScrollMotion from "@/components/ScrollMotion";

export default function Home() {
  return (
    <>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Knowledge />
        <Care />
        <ScanNotice />
        <CTAForm />
      </main>
      <Footer />
      <ScrollMotion />
    </>
  );
}
