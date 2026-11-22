import type { ProjectMeta } from "@/types/content";

/** Guided projects (Level 13). Bodies live in src/content/projects/<slug>.md. */
export const projects: ProjectMeta[] = [
  { slug: "file-organizer", number: 1, title: "Personal file organizer", summary: "Sort a messy Downloads folder into subfolders by file type, safely and repeatably.", difficulty: "beginner", hours: 1.5, concepts: ["for-loops", "case-statements", "parameter-expansion", "copying-and-moving"] },
  { slug: "backup-utility", number: 2, title: "Automated backup utility", summary: "Create timestamped, compressed backups with retention and a dry-run mode.", difficulty: "beginner", hours: 2, concepts: ["your-first-script", "positional-parameters", "exit-codes-and-validation", "backups-and-health-checks"] },
  { slug: "bulk-renamer", number: 3, title: "Bulk file renaming tool", summary: "Rename many files with patterns, previews and collision detection.", difficulty: "intermediate", hours: 2, concepts: ["parameter-expansion", "globbing", "getopts", "quoting"] },
  { slug: "log-analyzer", number: 4, title: "Log analyzer", summary: "Turn a raw web server access log into a readable traffic and error report.", difficulty: "intermediate", hours: 2.5, concepts: ["awk-programs", "log-parsing", "pipes", "sort-and-uniq"] },
  { slug: "disk-usage-monitor", number: 5, title: "Disk usage monitor", summary: "Find what is eating disk space and warn when usage crosses a threshold.", difficulty: "intermediate", hours: 2, concepts: ["disk-memory-cpu", "conditional-expressions", "functions"] },
  { slug: "health-check", number: 6, title: "System health monitoring script", summary: "Check CPU load, memory, disk, services and endpoints, and report a single status.", difficulty: "intermediate", hours: 3, concepts: ["functions", "exit-codes-and-validation", "processes-and-services", "logging-and-configuration"] },
  { slug: "cleanup-utility", number: 7, title: "Automated cleanup utility", summary: "Delete old temp files and logs by age and size with safety rails and a report.", difficulty: "intermediate", hours: 2, concepts: ["finding-files", "error-handling", "getopts"] },
  { slug: "menu-cli", number: 8, title: "Interactive menu-driven CLI", summary: "Build a menu-based task manager with input validation and persistent storage.", difficulty: "intermediate", hours: 3, concepts: ["reading-input", "case-statements", "while-and-until", "functions"] },
  { slug: "password-generator", number: 9, title: "Password generator", summary: "Generate secure random passwords with configurable length and character classes.", difficulty: "intermediate", hours: 1.5, concepts: ["getopts", "cut-paste-tr", "secure-scripting"] },
  { slug: "csv-processor", number: 10, title: "Bulk CSV processor", summary: "Validate, filter, aggregate and transform CSV files into reports.", difficulty: "advanced", hours: 3, concepts: ["awk-programs", "associative-arrays", "while-and-until"] },
  { slug: "git-repo-manager", number: 11, title: "Git repository management utility", summary: "Report status across many repositories and update them safely in bulk.", difficulty: "advanced", hours: 3, concepts: ["git-automation", "functions", "loop-control"] },
  { slug: "deploy-script", number: 12, title: "Automated deployment script", summary: "Build, release and roll back an application with atomic symlink switches.", difficulty: "advanced", hours: 4, concepts: ["deployment-scripts", "atomicity-and-idempotency", "signals-and-trap"] },
  { slug: "multi-server-backup", number: 13, title: "Multi-server backup manager", summary: "Back up many servers over SSH in parallel with per-host logs and a summary.", difficulty: "expert", hours: 4, concepts: ["networking-and-ssh", "job-control", "buffering-and-coproc"] },
  { slug: "process-monitor", number: 14, title: "Process monitoring utility", summary: "Watch processes, restart crashed ones with backoff and alert on repeated failures.", difficulty: "expert", hours: 4, concepts: ["processes-and-services", "signals-and-trap", "robust-patterns"] },
  { slug: "production-cli", number: 15, title: "Production-grade CLI application", summary: "A complete, tested, documented CLI with subcommands, config, logging and packaging.", difficulty: "expert", hours: 6, concepts: ["script-architecture", "testing-shell-scripts", "portability", "logging-and-configuration"] },
];

export function findProject(slug: string): ProjectMeta | undefined {
  return projects.find((p) => p.slug === slug);
}
