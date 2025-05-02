import { LevelForm } from "../level-form";

export const metadata = { title: "New Affiliate Level" };

export default function NewLevelPage() {
  return (
    <div className="container mx-auto py-6">
      <LevelForm />
    </div>
  );
}
