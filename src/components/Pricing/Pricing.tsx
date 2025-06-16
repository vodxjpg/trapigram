import React from 'react'
import PricingColumn from './PricingColumn'
import { plans } from '@/data/plans'

export interface PricingProps {
  /** optional callback for when a tier is “selected” */
  onSelectTier?: (plan: string) => void
}

const Pricing: React.FC<PricingProps> = ({ onSelectTier }) => (
  <div className="grid lg:grid-cols-3 gap-8">
    {plans.map((tier, i) => (
      <PricingColumn
        key={tier.name}
        tier={tier}
        highlight={i === 1}
        /** only pass an onSelect handler if the parent gave us one */
        onSelect={onSelectTier ? () => onSelectTier(tier.name) : undefined}
      />
    ))}
  </div>
)

export default Pricing
