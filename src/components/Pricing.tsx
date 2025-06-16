import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"

export default function Pricing() {
  const pricingTiers = [
    {
      name: "Starter",
      price: "$2,995",
      period: "/month",
      description: "Perfect for small businesses and startups",
      features: [
        "One request at a time",
        "Average 48 hour delivery",
        "Unlimited brands",
        "Unlimited users",
        "Design & development",
        "Slack communication",
      ],
      gradient: "from-blue-500 to-blue-600",
      popular: false,
    },
    {
      name: "Professional",
      price: "$4,995",
      period: "/month",
      description: "Most popular for growing companies",
      features: [
        "Two requests at a time",
        "Average 24 hour delivery",
        "Unlimited brands",
        "Unlimited users",
        "Design & development",
        "Slack communication",
        "Priority support",
        "Custom integrations",
      ],
      gradient: "from-purple-500 to-purple-600",
      popular: true,
    },
    {
      name: "Enterprise",
      price: "$7,995",
      period: "/month",
      description: "For large teams and complex projects",
      features: [
        "Unlimited requests",
        "Average 12 hour delivery",
        "Unlimited brands",
        "Unlimited users",
        "Design & development",
        "Slack communication",
        "Priority support",
        "Custom integrations",
        "Dedicated account manager",
        "Custom workflows",
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
                <span className="text-gray-600 ml-1">{tier.period}</span>
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
              Get Started
            </Button>

            <div className="text-center mt-4">
              <p className="text-sm text-gray-500">No contracts • Cancel anytime</p>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mt-12">
        <p className="text-gray-600 mb-4">Need a custom plan? We'd love to hear from you.</p>
        <Button variant="outline" className="border-gray-400 text-gray-700 hover:bg-gray-100">
          Contact Sales
        </Button>
      </div>
    </div>
  )
}
