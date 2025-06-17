export default function Features() {
  const features = [
    {
      title: "Predictable Pricing",
      description: "One flat monthly fee—no surprises, no hidden charges, unlimited bots.",
      illustration: "💸",
    },
    {
      title: "Rapid Deployment",
      description: "Get your Telegram shop up and running in under 5 minutes with our intuitive setup.",
      illustration: "🚀",
    },
    {
      title: "API-First Architecture",
      description: "Full-featured REST API lets you integrate, automate, and customize however you like.",
      illustration: "🔌",
    },
    {
      title: "Secure & PCI-Compliant",
      description: "Bank-grade encryption and built-in fraud protection keep you and your customers safe.",
      illustration: "🔒",
    },
    {
      title: "24/7 Customer Support",
      description: "Our expert team is here around the clock—chat, email, or phone, whenever you need us.",
      illustration: "📞",
    },
    {
      title: "Scalable Infrastructure",
      description: "Auto-scale your shop to handle any traffic surge without breaking a sweat.",
      illustration: "☁️",
    },
  ]

  return (
    <div className="bg-gray-200 rounded-3xl p-8 md:p-12">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {features.map((feature, index) => (
          <div key={index} className="bg-white rounded-2xl p-8 shadow-sm">
            <div className="text-4xl mb-4">{feature.illustration}</div>
            <h3 className="text-xl font-bold text-black mb-4">{feature.title}</h3>
            <p className="text-gray-600 leading-relaxed">{feature.description}</p>
          </div>
        ))}
      </div>

      <div className="text-center mt-16">
        <div className="text-6xl text-blue-600 mb-8">💬</div>
        <h2 className="text-3xl md:text-4xl font-bold text-black">
          “Our customers love the simplicity,<br />
          reliability, and 24/7 support.”
        </h2>
      </div>
    </div>
  )
}
