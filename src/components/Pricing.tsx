import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"

export default function Pricing() {
  const pricingTiers = [
    {
      name: "Starter",
      price: "$29",
      period: "/month",
      description: "Ideal for solo entrepreneurs starting out",
      features: [
        "1 Telegram shop",
        "Basic API access",
        "Limited products",
        "Analytics dashboard",
        "Email support",
        "Auto-scaling infrastructure",
      ],
      gradient: "from-blue-500 to-blue-600",
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
        "Unlmited products",
        "Analytics dashboard",
        "24/7 chat support",
        "Priority SLA (99.9% uptime)",
      ],
      gradient: "from-purple-500 to-purple-600",
      popular: true,
    },
    {
      name: "Enterprise",
      price: "$150",
      period: "/month",
      description: "For large teams and custom requirements",
      features: [
        "Unlimited shops",
        "Advanced API endpoints",
        "Unlmited products",
        "Analytics dashboard",
        "Custom integrations & workflows",
        "Dedicated account manager",
        "Onboarding & training",
        "Uptime & performance guarantees",
      ],
      gradient: "from-emerald-500 to-emerald-600",
      popular: false,
    },
  ]

  return (
    <div className="bg-gray-200 rounded-3xl p-8 md:p-12">
      <div className="grid md:grid-cols-3 gap-8">
        {pricingTiers.map((tier, index) => (
          <div
            key={index}
            className={`relative bg-white rounded-2xl p-8 shadow-sm ${
              tier.popular ? "ring-2 ring-purple-500 scale-105" : ""
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-purple-500 text-white px-4 py-2 rounded-full text-sm font-medium">
                  Most Popular
                </span>
              </div>
            )}

            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-black mb-2">{tier.name}</h3>
              <p className="text-gray-600 text-sm mb-4">{tier.description}</p>
              <div className="flex items-baseline justify-center">
                <span className="text-4xl font-bold text-black">{tier.price}</span>
                {tier.period && <span className="text-gray-600 ml-1">{tier.period}</span>}
              </div>
            </div>

            <ul className="space-y-4 mb-8">
              {tier.features.map((feature, featureIndex) => (
                <li key={featureIndex} className="flex items-center">
                  <Check className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              className={`w-full py-3 rounded-full font-medium ${
                tier.popular
                  ? "bg-purple-600 hover:bg-purple-700 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-black"
              }`}
            >
              {tier.popular ? "Get Started" : "Select Plan"}
            </Button>

            <div className="text-center mt-4">
              <p className="text-sm text-gray-500">No contracts • Cancel anytime</p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mt-12">
        <p className="text-gray-600 mb-4">Need a custom plan? We’d love to hear from you.</p>
        <Button variant="outline" className="border-gray-400 text-gray-700 hover:bg-gray-100">
          Contact Sales
        </Button>
      </div>
    </div>
  )
}
