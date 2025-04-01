export const plans = [
    {
      name: "tier1",
      price: 10,
      trialDays: 3,
      limits: {
        projects: 5,
        storage: 10,
      },
      features: ["5 Projects", "10 GB Storage", "Basic Support"],
    },
    {
      name: "tier2",
      price: 20,
      trialDays: 3,
      limits: {
        projects: 20,
        storage: 50,
      },
      features: ["20 Projects", "50 GB Storage", "Priority Support"],
    },
    {
      name: "tier3",
      price: 30,
      trialDays: 3,
      limits: {
        projects: 50,
        storage: 100,
      },
      features: ["50 Projects", "100 GB Storage", "24/7 Support"],
    },
  ];