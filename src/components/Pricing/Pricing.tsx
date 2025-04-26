import PricingColumn from "./PricingColumn";
import { plans } from "@/data/plans";

const Pricing: React.FC = () => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {plans.map((tier, index) => (
        <PricingColumn key={tier.name} tier={tier} highlight={index === 1} />
      ))}
    </div>
  );
};

export default Pricing;