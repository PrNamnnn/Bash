import type { Metadata } from "next";
import { curriculum } from "@/content/curriculum";
import { projects } from "@/content/projects";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your learning progress, streak, recent activity and skills — stored locally in your browser.",
};

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <Dashboard levels={curriculum} projects={projects} />
    </div>
  );
}
