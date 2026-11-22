"use client";

import { useState } from "react";
import { Segmented, VizFrame } from "../primitives";
import { cn } from "@/lib/cn";

type Mode = "login" | "nonlogin" | "script" | "ssh-cmd" | "bash-c";

const MODES: { value: Mode; label: string; example: string; desc: string }[] = [
  { value: "login", label: "login, interactive", example: "ssh user@host · login on a console · bash -l", desc: "A login shell reads the system profile, then the FIRST of ~/.bash_profile, ~/.bash_login, ~/.profile that exists." },
  { value: "nonlogin", label: "non-login, interactive", example: "opening a new terminal tab on most Linux desktops · typing bash", desc: "Interactive non-login shells read ~/.bashrc only (many distros also source /etc/bash.bashrc from it or by default)." },
  { value: "script", label: "non-interactive script", example: "./backup.sh · bash backup.sh · cron jobs", desc: "Scripts read no startup files at all — except the file named in $BASH_ENV, if set. That's why aliases and PS1 from .bashrc don't exist in scripts." },
  { value: "ssh-cmd", label: "ssh host 'command'", example: "ssh web01 'uptime'", desc: "A special case: Bash detects it was started by sshd to run a command and reads ~/.bashrc, even though the shell is non-interactive. This is why output in .bashrc can break scp and rsync." },
  { value: "bash-c", label: "bash -c 'cmd'", example: "bash -c 'echo hi' · sh -c in Makefiles and CI", desc: "Non-interactive: no startup files, only $BASH_ENV." },
];

export default function StartupViz() {
  const [mode, setMode] = useState<Mode>("login");
  const [hasProfile, setHasProfile] = useState(true);
  const [sourcesRc, setSourcesRc] = useState(true);
  const m = MODES.find((x) => x.value === mode)!;

  type F = { file: string; state: "read" | "skipped" | "not-checked"; note?: string };
  let files: F[];
  if (mode === "login") {
    files = [
      { file: "/etc/profile", state: "read", note: "system-wide; often sources /etc/profile.d/*.sh" },
      { file: "~/.bash_profile", state: hasProfile ? "read" : "skipped", note: hasProfile ? "found — the search stops here" : "does not exist" },
      { file: "~/.bash_login", state: hasProfile ? "not-checked" : "skipped", note: hasProfile ? "ignored: .bash_profile was found" : "does not exist" },
      { file: "~/.profile", state: hasProfile ? "not-checked" : "read", note: hasProfile ? "ignored: .bash_profile was found" : "read (common default on Debian/Ubuntu)" },
      { file: "~/.bashrc", state: sourcesRc ? "read" : "not-checked", note: sourcesRc ? "only because the profile explicitly sources it" : "NOT read automatically by login shells" },
      { file: "~/.bash_logout", state: "read", note: "when the login shell exits" },
    ];
  } else if (mode === "nonlogin" || mode === "ssh-cmd") {
    files = [
      { file: "/etc/bash.bashrc", state: "read", note: "Debian/Ubuntu: compiled-in default" },
      { file: "~/.bashrc", state: "read", note: mode === "ssh-cmd" ? "read even though non-interactive — keep it silent!" : "aliases, prompt, functions, shell options" },
      { file: "~/.bash_profile / ~/.profile", state: "not-checked", note: "not a login shell" },
    ];
  } else {
    files = [
      { file: "$BASH_ENV", state: "read", note: "only if the variable is set and names a file" },
      { file: "~/.bashrc", state: "not-checked", note: "not interactive" },
      { file: "~/.bash_profile / ~/.profile", state: "not-checked", note: "not a login shell" },
    ];
  }

  return (
    <VizFrame title="Shell startup sequence" footer="A common, robust setup: put everything in ~/.bashrc, and make ~/.bash_profile contain just `[ -f ~/.bashrc ] && . ~/.bashrc` plus login-only settings such as PATH. macOS Terminal opens login shells by default (and uses zsh since Catalina).">
      <div className="mb-3">
        <Segmented label="How Bash is started" value={mode} onChange={setMode} options={MODES.map((x) => ({ value: x.value, label: x.label }))} />
      </div>
      <p className="mb-1 text-[12px] text-fg-subtle">
        e.g. <span className="font-mono text-fg-muted">{m.example}</span>
      </p>
      <p className="mb-4 text-[13.5px] text-fg-muted">{m.desc}</p>
      {mode === "login" && (
        <div className="mb-3 flex flex-wrap gap-4 text-[12.5px] text-fg-muted">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hasProfile} onChange={(e) => setHasProfile(e.target.checked)} className="accent-[var(--color-accent)]" />
            ~/.bash_profile exists
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sourcesRc} onChange={(e) => setSourcesRc(e.target.checked)} className="accent-[var(--color-accent)]" />
            profile contains <code className="inline-code">. ~/.bashrc</code>
          </label>
        </div>
      )}
      <ol className="space-y-1.5">
        {files.map((f, i) => (
          <li
            key={f.file}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2",
              f.state === "read" ? "border-accent/40 bg-accent-dim/30" : f.state === "skipped" ? "border-line border-dashed" : "border-line/50 opacity-50",
            )}
          >
            <span className="w-4 font-mono text-[11px] text-fg-subtle">{f.state === "read" ? files.slice(0, i + 1).filter((x) => x.state === "read").length : "–"}</span>
            <code className={cn("font-mono text-[12.5px]", f.state === "read" ? "text-fg" : "text-fg-subtle")}>{f.file}</code>
            <span className="ml-auto text-right text-[12px] text-fg-muted">{f.note}</span>
          </li>
        ))}
      </ol>
    </VizFrame>
  );
}
