// /home/zodx/Desktop/trapigram/src/app/(landing)/page.tsx
import Hero from "@/components/Hero"
import Features from "@/components/Features"
import Pricing from "@/components/Pricing"
import Container from "@/components/Container"
import Section from "@/components/Section"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-800">
      <Hero />

      <Container>
        <Section id="features" title="Why Choose Us" description="Discover what makes us different">
          <Features />
        </Section>

        <Section id="pricing" title="Simple, Transparent Pricing" description="Choose the plan that works best for you">
          <Pricing />
        </Section>
      </Container>
    </div>
  )
}
