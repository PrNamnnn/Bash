---
objectives:
  - Diagnose connectivity with `ping`, `ip`, `ss`, `dig`/`getent` and `curl`
  - Use `curl` safely in scripts: fail on HTTP errors, time out, retry
  - Log in and run remote commands with `ssh` keys and `~/.ssh/config`
  - Copy files with `scp` and `rsync`, and automate across many hosts
summary:
  - "Layers to check: interface/IP (`ip addr`), route (`ip route`), DNS (`dig`, `getent hosts`), port reachability (`nc -z`, `curl`), listening sockets (`ss -tlnp`)."
  - "`curl -fsS --max-time 10 --retry 3 URL` — `-f` makes HTTP 4xx/5xx a non-zero exit; `-sS` is quiet but shows errors."
  - "SSH keys: `ssh-keygen -t ed25519`, `ssh-copy-id user@host`; keep `~/.ssh` at 700 and private keys at 600."
  - "`ssh host 'command'` runs one command remotely; use `-o BatchMode=yes -o ConnectTimeout=5` in scripts so they never hang on prompts."
  - "`rsync -az --delete src/ host:dest/` syncs efficiently; the trailing slash on src means \"contents of\"."
related:
  - processes-and-services
  - secure-scripting
  - deployment-scripts
---

## A troubleshooting ladder

When "it can't connect", work up the stack:

| Question | Command |
|---|---|
| Do I have an IP address? | `ip -br addr` |
| Do I have a route? | `ip route`, `ip route get 8.8.8.8` |
| Can I reach a host at all? | `ping -c 3 10.0.2.20` |
| Does the name resolve? | `getent hosts db.internal`, `dig +short db.internal` |
| Is the port open from here? | `nc -zv db.internal 5432`, `curl -v telnet://host:port` |
| Is the service listening on the server? | `ss -tlnp` (TCP, listening, numeric, process) |
| Is a firewall in the way? | `sudo nft list ruleset`, `sudo ufw status`, cloud security groups |
| Does HTTP work? | `curl -I https://example.com` |

`/etc/hosts` is checked before DNS (per `/etc/nsswitch.conf`), which is why `getent hosts` is a better test than `dig` for "what will programs actually use":

```bash title="hosts.sh" playground
cat /etc/hosts
lookup() { awk -v h="$1" '$0 !~ /^#/ { for (i = 2; i <= NF; i++) if ($i == h) { print $1; exit } }' /etc/hosts; }
for h in localhost db.internal mail.internal api.internal; do
  ip=$(lookup "$h")
  printf '%-14s %s\n' "$h" "${ip:-not in /etc/hosts (would ask DNS)}"
done
```

## Listening sockets: ss

```text
$ ss -tlnp
State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process
LISTEN  0       511           0.0.0.0:80          0.0.0.0:*      users:(("nginx",pid=812,fd=6))
LISTEN  0       244         127.0.0.1:5432        0.0.0.0:*      users:(("postgres",pid=901,fd=5))
```

`127.0.0.1:5432` means Postgres accepts only local connections — a common reason remote clients can't connect. (`netstat -tlnp` is the older equivalent.)

## curl in scripts

| Option | Why |
|---|---|
| `-f` / `--fail` | exit 22 on HTTP ≥ 400 instead of succeeding with an error page |
| `-sS` | silent progress, but still print errors |
| `-L` | follow redirects |
| `--max-time 10`, `--connect-timeout 5` | never hang forever |
| `--retry 3 --retry-delay 2` | survive transient failures |
| `-o file` / `-O` | save to a file |
| `-w '%{http_code}'` | print the status code |
| `-H 'Authorization: Bearer …'` | headers (beware of leaking tokens in `ps`; use `-H @file`) |
| `--json '{"a":1}'` | POST JSON (curl 7.82+) |

```bash
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://example.com/health)
[[ $status == 200 ]] || echo "health check failed: HTTP $status" >&2

curl -fsSL --retry 3 -o release.tgz "https://example.com/releases/v2.1.0.tgz"
```

For JSON responses, `jq` is the standard tool: `curl -fsS api/status | jq -r '.version'`.

## SSH

### Keys instead of passwords

```bash
ssh-keygen -t ed25519 -C "learner@laptop"     # creates ~/.ssh/id_ed25519 and .pub
ssh-copy-id deploy@web01                       # appends the public key to ~/.ssh/authorized_keys there
ssh deploy@web01                               # now logs in with the key
```

Permissions matter — sshd refuses keys if they're too open: `chmod 700 ~/.ssh; chmod 600 ~/.ssh/id_ed25519 ~/.ssh/authorized_keys`.

### ~/.ssh/config

```text
Host web*
    User deploy
    IdentityFile ~/.ssh/id_ed25519
Host web01
    HostName 10.0.1.11
Host web02
    HostName 10.0.1.12
Host bastion
    HostName bastion.example.com
Host db01
    HostName 10.0.2.20
    ProxyJump bastion
```

Now `ssh web01` and `scp file web02:/tmp/` use the right user, key and address — and `db01` is reached through the bastion host automatically.

### Remote commands

```bash
ssh web01 'uptime'                              # one command
ssh web01 'df -P /srv' | awk 'NR == 2 {print $5}'   # remote output, local processing
ssh web01 'bash -s' < local-script.sh           # run a local script remotely
ssh -n web01 uptime                             # -n: don't read stdin (important in loops)
```

For automation add `-o BatchMode=yes` (fail instead of prompting for a password) and `-o ConnectTimeout=5`.

## Copying files

| Tool | Best for |
|---|---|
| `scp file host:/path/` | one-off copies |
| `rsync -az src/ host:/dest/` | directories, repeated syncs (only differences are sent) |
| `rsync -az --delete src/ dest/` | exact mirror (removes extra files at dest — try `--dry-run` first) |
| `rsync -az --partial --progress big.iso host:` | resumable large transfers |

`rsync src dest/` copies the directory **itself** into dest; `rsync src/ dest/` copies its **contents**.

## Many hosts

```bash title="fleet.sh" playground
# The simulator can't open network connections; `run_remote` stands in for:
#   ssh -n -o BatchMode=yes -o ConnectTimeout=5 "$host" "$@"
run_remote() {
  local host=$1; shift
  case $host in
    cache01) return 255 ;;                       # unreachable
    *) echo "$(( RANDOM % 40 + 50 ))%" ;;        # pretend disk usage
  esac
}
while read -r host ip state; do
  if out=$(run_remote "$host" df -P /); then
    printf '%-8s %-11s disk %s\n' "$host" "$ip" "$out"
  else
    printf '%-8s %-11s UNREACHABLE (ssh status %d)\n' "$host" "$ip" $?
  fi
done < ~/data/servers.txt
```

SSH exits with **255** for connection problems, otherwise with the remote command's status — useful for distinguishing "host down" from "check failed".

## Common mistakes

```mistake
title: ssh in a while-read loop
wrong: |
  while read -r host; do ssh "$host" uptime; done < hosts.txt   # only the first host runs
right: |
  while read -r host; do ssh -n "$host" uptime; done < hosts.txt
why: ssh reads stdin and swallows the rest of hosts.txt. -n gives it /dev/null instead.
```

```mistake
title: curl without --fail
wrong: |
  curl -s https://api.example.com/data > data.json && process data.json   # a 500 error page gets processed
right: |
  curl -fsS --max-time 10 https://api.example.com/data -o data.json && process data.json
why: Without -f, curl exits 0 for any HTTP response, including errors.
```

## Practice

```exercise
kind: mcq
difficulty: intermediate
prompt: "`ss -tlnp` shows `127.0.0.1:5432`. Why can't other machines connect to PostgreSQL?"
options:
  - The firewall blocks port 5432
  - It listens only on the loopback interface
  - The port number is wrong
  - PostgreSQL is stopped
answer: 1
explanation: "127.0.0.1 is reachable only from the same machine; it should listen on 0.0.0.0 or a specific external address."
```

```exercise
kind: mcq
difficulty: intermediate
prompt: What is the difference between `rsync -a src dest/` and `rsync -a src/ dest/`?
options:
  - None
  - The first creates dest/src; the second copies the contents of src directly into dest
  - The second deletes files in dest
  - The first only copies new files
answer: 1
explanation: "A trailing slash on the source means \"the contents of this directory\"."
```

```exercise
kind: command
difficulty: beginner
prompt: "Print the IP address that `/etc/hosts` assigns to `db.internal`."
solution: awk '$2 == "db.internal" { print $1 }' /etc/hosts
explanation: "Each line is `IP name [aliases…]`."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Inventory to SSH config
prompt: "Generate an `~/.ssh/config` snippet from `~/data/servers.txt`: one `Host NAME` block with `HostName IP` and `User deploy` for every server whose state is `running`, separated by blank lines."
starter: |
  #!/usr/bin/env bash
solution: |
  #!/usr/bin/env bash
  first=1
  while read -r name ip state; do
    [[ $state == running ]] || continue
    (( first )) || echo
    first=0
    printf 'Host %s\n    HostName %s\n    User deploy\n' "$name" "$ip"
  done < ~/data/servers.txt
expectedOutput: |
  Host web01
      HostName 10.0.1.11
      User deploy

  Host web02
      HostName 10.0.1.12
      User deploy

  Host db01
      HostName 10.0.2.20
      User deploy

  Host mail01
      HostName 10.0.2.21
      User deploy
hints:
  - "Skip non-running servers with `continue`."
  - "Print the blank separator before every block except the first."
explanation: "Generating configuration from an inventory file keeps them in sync — a small step towards infrastructure as code."
```
