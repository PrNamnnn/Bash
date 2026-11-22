import type { Metadata } from "next";
import { TerminalWorkspace } from "@/components/terminal/terminal-workspace";

export const metadata: Metadata = {
  title: "Terminal playground",
  description: "A full-screen sandboxed Bash terminal with a realistic home directory, logs and datasets to explore.",
};

export default function TerminalPage() {
  return <TerminalWorkspace />;
}
