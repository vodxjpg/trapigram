'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { AffiliateProductForm } from '../components/affiliate-product-form'

export default function NewAffiliateProductPage() {
  const router = useRouter()
  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Affiliate Products
      </Button>

      <PageHeader
        title="Create Affiliate Product"
        description="Sell items for points"
      />

      <AffiliateProductForm />
    </div>
  )
}
