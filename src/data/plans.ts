// src/data/plans.ts
export const plans = [
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    description: "Ideal for solo entrepreneurs starting out",
    features: [
      "1 Telegram shop",
      "Basic API access",
      "Limited products",
      "Email support",
      "Auto-scaling infrastructure",
    ],
    popular: false,
  },
  {
    name: "Professional",
    price: "$99",
    period: "/month",
    description: "Best for growing businesses",
    features: [
      "Up to 5 Telegram shops",
      "Advanced API endpoints",
      "Unlimited products",
      "Analytics dashboard",
      "24/7 chat support",
      "Priority SLA (99.9% uptime)",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "$150",
    period: "/month",
    description: "For large teams and custom requirements",
    features: [
      "Unlimited shops & bots",
      "Advanced API endpoints",
      "Unlimited products",
      "Analytics dashboard",
      "Custom integrations & workflows",
      "Dedicated account manager",
      "Onboarding & training",
      "Uptime & performance guarantees",
    ],
    popular: false,
  },
]
