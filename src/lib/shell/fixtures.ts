import { makeDir, makeFile, VFS, type DirNode, type FsNode } from "./vfs";
import { externals } from "./commands";

/**
 * Sandbox filesystems. The default fixture is a realistic home directory with
 * logs, CSV data, scripts and a few traps (spaces in names, hidden files,
 * permission-protected paths) that lessons refer to.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Spec = { [name: string]: string | Spec | { content: string; mode?: number; owner?: string; age?: number } };

function build(spec: Spec, base: number, owner: string, dirMode = 0o755): DirNode {
  const dir = makeDir(dirMode, owner, base);
  for (const [name, value] of Object.entries(spec)) {
    let node: FsNode;
    if (typeof value === "string") node = makeFile(value, 0o644, owner, base);
    else if ("content" in value && typeof value.content === "string") {
      const v = value as { content: string; mode?: number; owner?: string; age?: number };
      node = makeFile(v.content, v.mode ?? 0o644, v.owner ?? owner, base - (v.age ?? 0));
    } else node = build(value as Spec, base, owner);
    dir.children.set(name, node);
  }
  return dir;
}

const accessLog = [
  '192.168.1.10 - - [10/Nov/2026:08:01:12 +0000] "GET / HTTP/1.1" 200 5320 "-" "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"',
  '192.168.1.10 - - [10/Nov/2026:08:01:13 +0000] "GET /css/site.css HTTP/1.1" 200 1842 "https://shop.example.com/" "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"',
  '203.0.113.45 - - [10/Nov/2026:08:02:40 +0000] "GET /products HTTP/1.1" 200 10234 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15"',
  '203.0.113.45 - - [10/Nov/2026:08:02:41 +0000] "GET /products/42 HTTP/1.1" 200 7710 "https://shop.example.com/products" "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15"',
  '198.51.100.7 - - [10/Nov/2026:08:03:05 +0000] "GET /wp-login.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
  '198.51.100.7 - - [10/Nov/2026:08:03:06 +0000] "GET /.env HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
  '198.51.100.7 - - [10/Nov/2026:08:03:06 +0000] "GET /admin HTTP/1.1" 403 548 "-" "python-requests/2.31.0"',
  '192.168.1.22 - - [10/Nov/2026:08:05:51 +0000] "POST /api/login HTTP/1.1" 200 312 "https://shop.example.com/login" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"',
  '192.168.1.22 - - [10/Nov/2026:08:05:58 +0000] "GET /api/cart HTTP/1.1" 200 1290 "https://shop.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"',
  '192.168.1.22 - - [10/Nov/2026:08:06:30 +0000] "POST /api/checkout HTTP/1.1" 500 89 "https://shop.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"',
  '203.0.113.45 - - [10/Nov/2026:08:07:02 +0000] "GET /products/17 HTTP/1.1" 200 6532 "https://shop.example.com/products" "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15"',
  '10.0.0.5 - - [10/Nov/2026:08:10:00 +0000] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.30"',
  '10.0.0.5 - - [10/Nov/2026:08:10:30 +0000] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.30"',
  '192.168.1.10 - - [10/Nov/2026:08:12:44 +0000] "GET /products?page=2 HTTP/1.1" 200 9921 "https://shop.example.com/products" "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"',
  '198.51.100.7 - - [10/Nov/2026:08:13:10 +0000] "GET /phpmyadmin HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
  '192.168.1.31 - - [10/Nov/2026:08:15:02 +0000] "GET /about HTTP/1.1" 200 3120 "https://www.google.com/" "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) Mobile Safari/604.1"',
  '192.168.1.31 - - [10/Nov/2026:08:15:09 +0000] "GET /images/logo.png HTTP/1.1" 304 0 "https://shop.example.com/about" "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) Mobile Safari/604.1"',
  '192.168.1.22 - - [10/Nov/2026:08:16:45 +0000] "POST /api/checkout HTTP/1.1" 500 89 "https://shop.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"',
  '10.0.0.5 - - [10/Nov/2026:08:20:00 +0000] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.30"',
  '203.0.113.99 - - [10/Nov/2026:08:21:17 +0000] "GET /products/42 HTTP/1.1" 200 7710 "https://duckduckgo.com/" "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0"',
  '203.0.113.99 - - [10/Nov/2026:08:21:30 +0000] "POST /api/cart HTTP/1.1" 201 148 "https://shop.example.com/products/42" "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0"',
  '203.0.113.99 - - [10/Nov/2026:08:22:02 +0000] "POST /api/checkout HTTP/1.1" 200 410 "https://shop.example.com/cart" "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0"',
  '192.168.1.10 - - [10/Nov/2026:08:25:39 +0000] "GET /contact HTTP/1.1" 200 2875 "https://shop.example.com/" "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"',
  '198.51.100.7 - - [10/Nov/2026:08:26:00 +0000] "GET /backup.zip HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
  '192.168.1.45 - - [10/Nov/2026:08:30:12 +0000] "GET /products HTTP/1.1" 200 10234 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0"',
  '192.168.1.45 - - [10/Nov/2026:08:30:20 +0000] "GET /products/7 HTTP/1.1" 404 162 "https://shop.example.com/products" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0"',
  '10.0.0.5 - - [10/Nov/2026:08:30:00 +0000] "GET /health HTTP/1.1" 200 2 "-" "kube-probe/1.30"',
  '192.168.1.22 - - [10/Nov/2026:08:31:05 +0000] "POST /api/checkout HTTP/1.1" 200 405 "https://shop.example.com/cart" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"',
  '203.0.113.45 - - [10/Nov/2026:08:35:48 +0000] "GET /api/products?q=lamp HTTP/1.1" 200 2210 "https://shop.example.com/products" "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15"',
  '192.168.1.31 - - [10/Nov/2026:08:40:11 +0000] "GET / HTTP/1.1" 200 5320 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) Mobile Safari/604.1"',
].join("\n") + "\n";

const appLog = [
  "2026-11-10T08:00:01Z INFO  [main] Starting order-service v2.4.1",
  "2026-11-10T08:00:02Z INFO  [db] Connected to postgres://db.internal:5432/orders",
  "2026-11-10T08:00:02Z INFO  [http] Listening on :8080",
  "2026-11-10T08:05:51Z INFO  [auth] user=alice action=login status=ok",
  "2026-11-10T08:06:30Z ERROR [checkout] user=alice order=1042 error=\"payment gateway timeout\" duration_ms=30012",
  "2026-11-10T08:06:31Z WARN  [checkout] retrying payment for order=1042 attempt=1",
  "2026-11-10T08:10:00Z INFO  [health] ok",
  "2026-11-10T08:12:13Z WARN  [cache] redis latency high latency_ms=412",
  "2026-11-10T08:16:45Z ERROR [checkout] user=alice order=1043 error=\"payment gateway timeout\" duration_ms=30008",
  "2026-11-10T08:20:00Z INFO  [health] ok",
  "2026-11-10T08:21:30Z INFO  [cart] user=bob action=add sku=LMP-42 qty=1",
  "2026-11-10T08:22:02Z INFO  [checkout] user=bob order=1044 status=paid amount=89.90",
  "2026-11-10T08:24:59Z WARN  [db] slow query duration_ms=1840 table=orders",
  "2026-11-10T08:30:00Z INFO  [health] ok",
  "2026-11-10T08:31:05Z INFO  [checkout] user=alice order=1045 status=paid amount=42.50",
  "2026-11-10T08:33:20Z ERROR [mailer] smtp connection refused host=mail.internal:587",
  "2026-11-10T08:35:48Z INFO  [search] q=lamp results=12 duration_ms=38",
  "2026-11-10T08:40:00Z INFO  [health] ok",
].join("\n") + "\n";

const sales = `date,region,product,units,unit_price
2026-10-01,north,lamp,12,24.50
2026-10-01,south,desk,3,189.00
2026-10-02,east,chair,8,79.90
2026-10-02,north,desk,2,189.00
2026-10-03,west,lamp,20,24.50
2026-10-03,south,chair,5,79.90
2026-10-04,east,lamp,7,24.50
2026-10-04,west,desk,4,189.00
2026-10-05,north,chair,11,79.90
2026-10-05,south,lamp,9,24.50
2026-10-06,east,desk,1,189.00
2026-10-06,west,chair,6,79.90
2026-10-07,north,lamp,15,24.50
2026-10-07,south,desk,2,189.00
2026-10-08,east,chair,10,79.90
2026-10-08,west,lamp,18,24.50
`;

const users = `id,name,email,role,active
1,Alice Johnson,alice@example.com,admin,yes
2,Bob Smith,bob@example.com,developer,yes
3,Carol White,carol@example.com,developer,no
4,Dan Brown,dan@example.org,support,yes
5,Eve Davis,eve@example.com,developer,yes
6,Frank Miller,frank@example.net,support,no
7,Grace Lee,grace@example.com,admin,yes
`;

const fruits = "apple\nbanana\ncherry\napple\ndate\nbanana\napple\nelderberry\nfig\ncherry\n";

const backupSh = `#!/usr/bin/env bash
# Back up a directory into a timestamped tar file.
set -euo pipefail

src="\${1:?usage: backup.sh SOURCE_DIR}"
dest="\${BACKUP_DIR:-$HOME/backups}"
stamp="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$dest"
echo "Backing up $src to $dest/backup-$stamp.tar.gz"
`;

const greetSh = `#!/usr/bin/env bash
# Greet everyone given on the command line.
if [[ $# -eq 0 ]]; then
  echo "usage: $0 NAME..." >&2
  exit 1
fi
for name in "$@"; do
  printf 'Hello, %s!\\n' "$name"
done
`;

const brokenSh = `#!/usr/bin/env bash
# This script has bugs on purpose. Can you find them?
file=notes.txt
if [ -f $file ]
then
  count=$(wc -l < $file)
  echo "$file has $count lines"
fi
greeting = "hello"
echo $greeting
`;

const deploySh = `#!/usr/bin/env bash
# Not executable yet: try ./deploy.sh, then chmod +x deploy.sh
echo "Deploying version \${1:-latest}..."
`;

const bashrc = `# ~/.bashrc: executed by bash for interactive non-login shells.

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

HISTSIZE=1000
HISTFILESIZE=2000
shopt -s histappend

alias ll='ls -alF'
alias la='ls -A'
alias grep='grep --color=auto'

export EDITOR=nano
`;

const profile = `# ~/.profile: executed by the command interpreter for login shells.
if [ -n "$BASH_VERSION" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi

if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi
`;

const passwd = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
syslog:x:104:110::/home/syslog:/usr/sbin/nologin
postgres:x:113:120:PostgreSQL administrator:/var/lib/postgresql:/bin/bash
learner:x:1000:1000:Bash Learner,,,:/home/learner:/bin/bash
deploy:x:1001:1001:Deploy User:/home/deploy:/bin/bash
`;

export function createDefaultFs(): VFS {
  const now = Date.now();
  const base = now - 3 * DAY;
  const commands: Record<string, string | { content: string; mode: number; owner: string }> = {};
  for (const name of Object.keys(externals)) {
    commands[name] = { content: `#!/sim/bin/${name}\n`, mode: 0o755, owner: "root" };
  }
  const root = build(
    {
      // Modern distributions merge /bin into /usr/bin; mirror the commands in both places.
      bin: {
        ...commands,
        bash: { content: "#!/sim/bin/bash\n", mode: 0o755, owner: "root" },
        sh: { content: "#!/sim/bin/sh\n", mode: 0o755, owner: "root" },
      },
      etc: {
        hostname: { content: "bash-mastery\n", owner: "root" },
        hosts: { content: "127.0.0.1\tlocalhost\n127.0.1.1\tbash-mastery\n10.0.2.20\tdb.internal\n10.0.2.21\tmail.internal\n", owner: "root" },
        passwd: { content: passwd, owner: "root" },
        group: { content: "root:x:0:\nsudo:x:27:learner\nusers:x:100:learner\nlearner:x:1000:\ndeploy:x:1001:\n", owner: "root" },
        shadow: { content: "root:*:19700:0:99999:7:::\nlearner:$6$sim$hash:19700:0:99999:7:::\n", mode: 0o640, owner: "root" },
        shells: { content: "/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/dash\n", owner: "root" },
        "os-release": { content: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\n', owner: "root" },
        profile: { content: "# /etc/profile: system-wide .profile file for login shells\nexport PATH=/usr/local/bin:/usr/bin:/bin\n", owner: "root" },
        "bash.bashrc": { content: "# System-wide .bashrc file for interactive bash(1) shells.\n[ -z \"$PS1\" ] && return\nshopt -s checkwinsize\n", owner: "root" },
        crontab: { content: "# /etc/crontab: system-wide crontab\nSHELL=/bin/sh\n17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n25 6\t* * *\troot\ttest -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n", owner: "root" },
      },
      home: {},
      root: {},
      tmp: {},
      opt: {},
      usr: { bin: commands, local: { bin: {} }, share: { doc: {} } },
      var: {
        log: {
          syslog: { content: "Nov 10 08:00:01 bash-mastery systemd[1]: Started Daily apt download activities.\nNov 10 08:05:12 bash-mastery CRON[2211]: (root) CMD (run-parts /etc/cron.hourly)\nNov 10 08:10:44 bash-mastery kernel: [ 9321.112] eth0: link up\nNov 10 08:30:02 bash-mastery systemd[1]: Starting Cleanup of Temporary Directories...\n", owner: "root" },
          "auth.log": { content: "Nov 10 07:58:01 bash-mastery sshd[1880]: Accepted publickey for learner from 192.168.1.5\n", mode: 0o640, owner: "root" },
        },
        www: { html: { "index.html": { content: "<!doctype html>\n<title>It works</title>\n<h1>It works!</h1>\n", owner: "root" } } },
      },
      dev: {
        null: { content: "", mode: 0o666, owner: "root" },
        zero: { content: "", mode: 0o666, owner: "root" },
        urandom: { content: "", mode: 0o666, owner: "root" },
        random: { content: "", mode: 0o666, owner: "root" },
        tty: { content: "", mode: 0o666, owner: "root" },
        stdin: { content: "", mode: 0o666, owner: "root" },
        stdout: { content: "", mode: 0o666, owner: "root" },
        stderr: { content: "", mode: 0o666, owner: "root" },
      },
    },
    base - 30 * DAY,
    "root",
  );
  const rootDir = root.children.get("root") as DirNode;
  rootDir.mode = 0o700;
  (root.children.get("tmp") as DirNode).mode = 0o1777;
  (root.children.get("tmp") as DirNode).owner = "root";

  const home = build(
    {
      ".bashrc": bashrc,
      ".profile": profile,
      ".bash_logout": "# ~/.bash_logout: executed by bash(1) when login shell exits.\n",
      ".config": { "app.conf": "# Application settings\nport=8080\nlog_level=info\ndb_host=db.internal\n" },
      "notes.txt": "Bash is a shell and a programming language.\nThe shell reads commands and runs programs.\nPipes connect small tools into powerful pipelines.\n\nRemember: quote your variables!\nPractice a little every day.\n",
      "todo.txt": "- learn ls and cd\n- understand quoting\n- write my first script\n- automate backups\n",
      projects: {
        website: {
          "index.html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>My Site</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello, world</h1>\n  <script src="app.js"></script>\n</body>\n</html>\n',
          "style.css": "body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n\nh1 {\n  color: #2d6a4f;\n}\n",
          "app.js": "// TODO: add analytics\nconsole.log('site loaded');\n// TODO: lazy-load images\n",
          "README.md": "# Website\n\nA tiny static site used in the Bash Mastery exercises.\n\n## Deploy\n\nRun `../scripts/deploy.sh` to publish.\n",
        },
        scripts: {
          "backup.sh": { content: backupSh, mode: 0o755 },
          "greet.sh": { content: greetSh, mode: 0o755 },
          "broken.sh": { content: brokenSh, mode: 0o755 },
          "deploy.sh": { content: deploySh, mode: 0o644 },
        },
      },
      logs: {
        "access.log": accessLog,
        "app.log": appLog,
        "error.log": "2026/11/10 08:06:30 [error] 812#812: *41 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 192.168.1.22, request: \"POST /api/checkout HTTP/1.1\"\n2026/11/10 08:16:45 [error] 812#812: *77 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 192.168.1.22, request: \"POST /api/checkout HTTP/1.1\"\n",
        archive: {
          "access.log.1": { content: accessLog.split("\n").slice(0, 8).join("\n").replace(/10\/Nov/g, "09/Nov") + "\n", age: 1 * DAY },
          "access.log.2": { content: accessLog.split("\n").slice(4, 12).join("\n").replace(/10\/Nov/g, "08/Nov") + "\n", age: 2 * DAY },
        },
      },
      data: {
        "sales.csv": sales,
        "users.csv": users,
        "fruits.txt": fruits,
        "numbers.txt": "42\n7\n19\n3\n100\n58\n7\n23\n",
        "servers.txt": "web01 10.0.1.11 running\nweb02 10.0.1.12 running\ndb01 10.0.2.20 running\ncache01 10.0.3.30 stopped\nmail01 10.0.2.21 running\n",
        "config.ini": "[server]\nhost = 0.0.0.0\nport = 8080\n\n[database]\nhost = db.internal\nport = 5432\nname = orders\n",
        "inventory.json": '{\n  "items": [\n    {"sku": "LMP-42", "name": "Desk lamp", "stock": 31},\n    {"sku": "DSK-10", "name": "Standing desk", "stock": 4},\n    {"sku": "CHR-07", "name": "Office chair", "stock": 0}\n  ]\n}\n',
        "old.txt": "alpha\nbeta\ngamma\ndelta\n",
        "new.txt": "alpha\nbeta\nGAMMA\ndelta\nepsilon\n",
      },
      photos: {
        "IMG_0001.JPG": "",
        "IMG_0002.JPG": "",
        "IMG_0003.JPG": "",
        "holiday 2025.png": "",
        "screenshot.PNG": "",
      },
      downloads: {
        "report-2026.pdf": "%PDF-1.7 (simulated)\n",
        "invoice_jan.pdf": "%PDF-1.7 (simulated)\n",
        "setup.tar.gz": "",
        "notes (copy).txt": "Bash is a shell and a programming language.\n",
        "music.mp3": "",
      },
      ".ssh": { config: "Host web01\n  HostName 10.0.1.11\n  User deploy\n", "id_ed25519.pub": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISIMULATEDKEY learner@bash-mastery\n" },
    },
    base,
    "learner",
  );
  (home.children.get(".ssh") as DirNode).mode = 0o700;
  const homeRoot = root.children.get("home") as DirNode;
  homeRoot.children.set("learner", home);
  return new VFS(root);
}

/** A minimal home directory for exercises that want a blank slate. */
export function createEmptyFs(): VFS {
  const fs = createDefaultFs();
  const home = fs.lookup("/home/learner") as DirNode;
  for (const name of [...home.children.keys()]) if (!name.startsWith(".")) home.children.delete(name);
  return fs;
}

export type FixtureName = "default" | "empty";

export function createFs(name: string | undefined): VFS {
  if (name === "empty") return createEmptyFs();
  return createDefaultFs();
}
