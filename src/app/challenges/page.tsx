import type { Metadata } from "next";
import { getChallenges } from "@/lib/content/extras";
import { ChallengeBoard } from "@/components/challenges/challenge-board";
import { findLesson } from "@/lib/curriculum";

export const metadata: Metadata = {
  title: "Challenges",
  description: "Beginner to expert Bash challenges: predict the output, find the bug, write the command, complete the script.",
};

export default function ChallengesPage() {
  const challenges = getChallenges().map((c) => ({ ...c, lessonTitle: c.lesson ? findLesson(c.lesson)?.title : undefined }));
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono text-[12px] text-accent">~/challenges</p>
        <h1 className="text-[30px] font-semibold tracking-tight text-fg">Challenges</h1>
        <p className="mt-2 text-[15px] text-fg-muted">
          {challenges.length} standalone problems that mix concepts from across the course. Predict outputs, hunt bugs, write commands that run in the simulator and complete real scripts.
          Hints are available; solutions unlock after two honest attempts.
        </p>
      </header>
      <ChallengeBoard challenges={challenges} />
    </div>
  );
}
