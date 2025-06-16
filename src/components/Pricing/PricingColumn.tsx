import React from 'react'
import clsx from 'clsx'
import { BsFillCheckCircleFill } from 'react-icons/bs'
import Link from 'next/link'

interface Tier {
  name: string
  price: string
  period: string
  description: string
  features: string[]
  popular: boolean
}

interface Props {
  tier: Tier
  highlight?: boolean
  /** If provided, we’ll render a <button> and call this on click;
   * otherwise we fall back to a <Link> to the sign-up page. */
  onSelect?: () => void
}

const PricingColumn: React.FC<Props> = ({ tier, highlight, onSelect }) => {
  const btnStyles = clsx(
    'w-full py-3 rounded-full transition-colors',
    highlight
      ? 'bg-primary text-white hover:bg-primary-accent'
      : 'bg-gray-200 text-black hover:bg-black hover:text-white'
  )

  return (
    <div
      className={clsx(
        'bg-white rounded-xl border border-gray-200',
        highlight && 'shadow-lg ring-2 ring-purple-500 scale-105'
      )}
    >
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-2xl font-semibold mb-2">{tier.name}</h3>
        <p className="text-gray-600 text-sm mb-4">{tier.description}</p>
        <div className="flex items-baseline">
          <span className="text-4xl font-bold">{tier.price}</span>
          {tier.period && (
            <span className="ml-1 text-lg text-gray-600">{tier.period}</span>
          )}
        </div>
      </div>
      <div className="p-6">
        <ul className="space-y-4 mb-6">
          {tier.features.map((f) => (
            <li key={f} className="flex items-center">
              <BsFillCheckCircleFill className="h-5 w-5 text-secondary mr-2" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {onSelect ? (
          <button onClick={onSelect} className={btnStyles}>
            {highlight ? 'Get Started' : 'Select Plan'}
          </button>
        ) : (
          <Link href={`/sign-up?tier=${tier.name.toLowerCase()}`}>
            <a className={btnStyles}>
              {highlight ? 'Get Started' : 'Select Plan'}
            </a>
          </Link>
        )}
      </div>
    </div>
  )
}

export default PricingColumn
