export default function Features() {
    const features = [
      {
        title: "Flat Monthly Fee",
        description: "Every month, the price stays the same — no guesswork, no surprises",
        illustration: "💰",
      },
      {
        title: "Fast Turnaround",
        description: "Truly amazing designs made for you, ready in just a few days",
        illustration: "⚡",
      },
      {
        title: "Unlimited Revisions",
        description: "Change it, swap it, until it's just right — as many times as you want",
        illustration: "🔄",
      },
      {
        title: "Full Design Service",
        description: "Scale up or down as needed, and pause or cancel at anytime",
        illustration: "🎨",
      },
      {
        title: "No Contracts, No Headaches",
        description: "Just amazing designs with no tricky rules or papers to sign",
        illustration: "✨",
      },
      {
        title: "Expert Team",
        description: "Work with experienced designers who understand your vision",
        illustration: "👥",
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
            Trapigram like their work method,
            <br />
            design skill, and the way
          </h2>
        </div>
      </div>
    )
  }
  