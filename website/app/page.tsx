import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { QuickStartSection } from "@/components/landing/QuickStartSection";
import { ExamplesSection } from "@/components/landing/ExamplesSection";
import { CtaSection } from "@/components/landing/CtaSection";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <ProblemSection />
        <HowItWorksSection />
        <FeaturesSection />
        <QuickStartSection />
        <ExamplesSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
