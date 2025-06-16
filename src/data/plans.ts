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
      "24/7 chat support",
      "Priority SLA (99.9% uptime)",
      "Analytics dashboard",
      "Webhooks & integrations",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large teams and custom requirements",
    features: [
      "Unlimited shops & bots",
      "Dedicated API SLA",
      "Unlimited products",
      "Custom integrations & workflows",
      "Dedicated account manager",
      "Onboarding & training",
      "Uptime & performance guarantees",
    ],
    popular: false,
  },
]
