// src/app/(dashboard)/affiliates/products/new/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { AffiliateProductForm } from '../components/affiliate-product-form'
import { useHasPermission } from '@/hooks/use-has-permission'
import { authClient } from '@/lib/auth-client'

export default function NewAffiliateProductPage() {
  const router = useRouter()

  // Active organization → permission context
  const { data: activeOrg } = authClient.useActiveOrganization()
  const organizationId      = activeOrg?.id ?? null

  // Check affiliates:products permission
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { affiliates: ['products'] })

  // Redirect if no permission
  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace('/affiliates/products')
    }
  }, [permLoading, canCreate, router])

  // Guard while loading or unauthorized
  if (permLoading) return null
  if (!canCreate) return null

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
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
