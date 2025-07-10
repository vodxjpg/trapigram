import Hero from "@/components/Hero"
import ProductImportGuide from "@/components/ImportGuide"
import Container from "@/components/Container"
import Section from "@/components/Section"

export default function ImportPage() {
  return (
    <div className="min-h-screen bg-gray-200 ">
      <Container>
        <Section id="import-products">
          <ProductImportGuide />
        </Section>
      </Container>
    </div>
  )
}
