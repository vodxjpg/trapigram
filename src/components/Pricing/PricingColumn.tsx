import clsx from "clsx";
import { BsFillCheckCircleFill } from "react-icons/bs";
import Link from "next/link";

interface Props {
  tier: {
    name: string;
    price: number;
    trialDays: number;
    limits: { projects: number; storage: number };
    features: string[];
  };
  highlight?: boolean;
}

const PricingColumn: React.FC<Props> = ({ tier, highlight }: Props) => {
  const { name, price, features } = tier;

  return (
    <div className={clsx("w-full max-w-sm mx-auto bg-white rounded-xl border border-gray-200 lg:max-w-full", { "shadow-lg": highlight })}>
      <div className="p-6 border-b border-gray-200 rounded-t-xl">
        <h3 className="text-2xl font-semibold mb-4">{name.charAt(0).toUpperCase() + name.slice(1)}</h3>
        <p className="text-3xl md:text-5xl font-bold mb-6">
          <span className={clsx({ "text-black": highlight })}>${price}</span>
          <span className="text-lg font-normal text-black">/mo</span>
        </p>
        <Link href={`/sign-up?tier=${name}`}>
          <button className={clsx("w-full py-3 px-4 rounded-full transition-colors", { " text-white bg-primary hover:bg-primary-accent": highlight, "bg-gray-200 hover:bg-black hover:text-white": !highlight })}>
            Get Started
          </button>
        </Link>
      </div>
      <div className="p-6 mt-1">
        <p className="font-bold mb-0">FEATURES</p>
        <p className="text-foreground-accent mb-5">Everything in basic, plus...</p>
        <ul className="space-y-4 mb-8">
          {features.map((feature, index) => (
            <li key={index} className="flex items-center">
              <BsFillCheckCircleFill className="h-5 w-5 text-secondary mr-2" />
              <span className="text-foreground-accent">{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default PricingColumn;