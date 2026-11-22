import { describe, expect, it } from "vitest";
import { runScript, ShellSession } from "../index";

const run = (code: string, opts: { stdin?: string; args?: string } = {}) => runScript({ code, ...opts });
const out = (code: string, opts: { stdin?: string; args?: string } = {}) => run(code, opts).stdout;

describe("words and quoting", () => {
  it("echo and splitting", () => {
    expect(out("echo hello   world")).toBe("hello world\n");
    expect(out('x="a  b"; echo $x; echo "$x"')).toBe("a b\na  b\n");
    expect(out("echo '$HOME' \"$HOME\"")).toBe("$HOME /home/learner\n");
    expect(out(`echo "a\\"b" 'it'\\''s'`)).toBe('a"b it\'s\n');
    expect(out("echo $'tab\\there'")).toBe("tab\there\n");
    expect(out('set -- "a b" c; for x in "$@"; do echo "[$x]"; done')).toBe("[a b]\n[c]\n");
    expect(out('set -- "a b" c; for x in $@; do echo "[$x]"; done')).toBe("[a]\n[b]\n[c]\n");
    expect(out('set -- "a b" c; echo "$*"; IFS=,; echo "$*"')).toBe("a b c\na b,c\n");
    expect(out('e=""; printf "[%s]" $e "$e" x; echo')).toBe("[][x]\n");
    expect(out('set --; for a in "$@"; do echo "[$a]"; done; echo n=$#; printf "<%s>" "" "$@"; echo')).toBe("n=0\n<>\n");
    expect(out('f() { printf "%s|" "$@"; echo; }; f; f ""; f a "b c"')).toBe("|\n|\na|b c|\n");
  });
  it("brace and tilde", () => {
    expect(out("echo {1..5}")).toBe("1 2 3 4 5\n");
    expect(out("echo a{b,c}d")).toBe("abd acd\n");
    expect(out("echo {01..03} {a..c} {10..0..5}")).toBe("01 02 03 a b c 10 5 0\n");
    expect(out("echo ~ ~/x")).toBe("/home/learner /home/learner/x\n");
    expect(out('echo "{a,b}"')).toBe("{a,b}\n");
  });
  it("globs", () => {
    expect(out("cd data && echo *.csv")).toBe("sales.csv users.csv\n");
    expect(out("echo nomatch*")).toBe("nomatch*\n");
    expect(out("shopt -s nullglob; echo nomatch* end")).toBe("end\n");
    expect(out("cd photos && echo IMG_000[12].JPG")).toBe("IMG_0001.JPG IMG_0002.JPG\n");
    expect(out('cd data && echo "*.csv"')).toBe("*.csv\n");
  });
});

describe("expansions", () => {
  it("arithmetic", () => {
    expect(out("echo $((2+3*4)) $((7/2)) $((7%3)) $((2**10)) $(( (1+2)*3 ))")).toBe("14 3 1 1024 9\n");
    expect(out("((x=5, y=x*2)); echo $x $y; ((x++)); echo $x")).toBe("5 10\n6\n");
    expect(out("i=0; ((i++)); echo $?; ((i++)); echo $?")).toBe("1\n0\n");
    expect(out("a=3; echo $(( a > 2 ? 10 : 20 ))")).toBe("10\n");
  });
  it("parameter expansion", () => {
    expect(out("f=archive.tar.gz; echo ${f%.gz} ${f%%.*} ${f#*.} ${f##*.}")).toBe("archive.tar archive tar.gz gz\n");
    expect(out("s=hello; echo ${#s} ${s:1:3} ${s^^} ${s^} ${s/l/L} ${s//l/L} ${s: -2}")).toBe("5 ell HELLO Hello heLlo heLLo lo\n");
    expect(out("unset x; echo ${x:-def} ${x-def2}; x=; echo [${x:-d}] [${x-d}]")).toBe("def def2\n[d] []\n");
    expect(out("echo ${y:=set}; echo $y")).toBe("set\nset\n");
    expect(out("v=x; echo ${v:+alt} [${u:+alt}]")).toBe("alt []\n");
    expect(out("p=/usr/local/bin/tool; echo ${p##*/} ${p%/*}")).toBe("tool /usr/local/bin\n");
    expect(out("name=v; v=42; echo ${!name}")).toBe("42\n");
  });
  it("command substitution", () => {
    expect(out('x=$(printf "a\\n\\n"); echo "[$x]"')).toBe("[a]\n");
    expect(out("echo `echo hi` $(echo $(echo nested))")).toBe("hi nested\n");
    expect(out("x=$(false); echo $?")).toBe("1\n");
  });
});

describe("control flow", () => {
  it("if / test / [[ ]]", () => {
    expect(out("if [[ 5 -gt 3 ]]; then echo yes; else echo no; fi")).toBe("yes\n");
    expect(out("if [ -f notes.txt ] && [ ! -d notes.txt ]; then echo file; fi")).toBe("file\n");
    expect(out('[[ abc == a* ]] && echo glob; [[ "abc" == "a*" ]] || echo literal')).toBe("glob\nliteral\n");
    expect(out("[[ 2026-11-10 =~ ^([0-9]{4})-([0-9]{2}) ]] && echo ${BASH_REMATCH[1]} ${BASH_REMATCH[2]}")).toBe("2026 11\n");
    expect(out('x=; if [ -z "$x" ]; then echo empty; fi')).toBe("empty\n");
    expect(run("[ 1 -eq a ]").stderr).toContain("integer expression expected");
  });
  it("loops", () => {
    expect(out("for i in 1 2 3; do echo $i; done")).toBe("1\n2\n3\n");
    expect(out("for ((i=0; i<3; i++)); do printf '%d ' $i; done; echo")).toBe("0 1 2 \n");
    expect(out("n=3; while ((n > 0)); do echo $n; ((n--)); done")).toBe("3\n2\n1\n");
    expect(out("n=0; until [ $n -ge 2 ]; do echo $n; n=$((n+1)); done")).toBe("0\n1\n");
    expect(out("for i in 1 2 3 4; do [ $i = 2 ] && continue; [ $i = 4 ] && break; echo $i; done")).toBe("1\n3\n");
    expect(out("for i in 1 2; do for j in a b; do [ $j = b ] && continue 2; echo $i$j; done; done")).toBe("1a\n2a\n");
    expect(out("printf '1\\n2\\n' | while read n; do echo $((n*2)); done")).toBe("2\n4\n");
    expect(out("while IFS=, read -r a b; do echo \"$b-$a\"; done <<< 'x,y'")).toBe("y-x\n");
  });
  it("case", () => {
    const code = "for f in a.txt b.JPG c; do case $f in *.txt) echo text;; *.jpg|*.JPG) echo image;; *) echo other;; esac; done";
    expect(out(code)).toBe("text\nimage\nother\n");
  });
  it("functions and scope", () => {
    expect(out("f() { local x=1; echo $x; }; x=2; f; echo $x")).toBe("1\n2\n");
    expect(out("g() { y=inner; }; g; echo $y")).toBe("inner\n");
    expect(out("add() { echo $(( $1 + $2 )); }; add 2 3")).toBe("5\n");
    expect(out("f() { return 3; }; f; echo $?")).toBe("3\n");
    expect(out("fact() { if (( $1 <= 1 )); then echo 1; else echo $(( $1 * $(fact $(( $1 - 1 ))) )); fi; }; fact 5")).toBe("120\n");
  });
});

describe("arrays", () => {
  it("indexed", () => {
    expect(out('a=(x y z); echo ${#a[@]} ${a[1]} "${a[@]}" ${a[-1]}')).toBe("3 y x y z z\n");
    expect(out("a=(1 2); a+=(3); a[5]=6; echo ${!a[@]}; echo ${a[@]:1:2}")).toBe("0 1 2 5\n2 3\n");
    expect(out('a=("one two" three); for x in "${a[@]}"; do echo "<$x>"; done')).toBe("<one two>\n<three>\n");
    expect(out("mapfile -t lines < data/numbers.txt; echo ${#lines[@]} ${lines[0]}")).toBe("8 42\n");
  });
  it("associative", () => {
    expect(out("declare -A m=([k]=v [a]=b); echo ${m[k]} ${#m[@]}; m[z]=1; echo ${m[z]}")).toBe("v 2\n1\n");
    expect(out("declare -A c; for w in a b a; do ((c[$w]++)); done; echo ${c[a]} ${c[b]}")).toBe("2 1\n");
    expect(out("f() { local -a arr=(p q); echo ${arr[1]}; }; f")).toBe("q\n");
    expect(out("declare -A c; ip=10.0.0.5; ((c[$ip]++)); ((c[$ip]++)); echo ${c[10.0.0.5]}")).toBe("2\n");
    expect(out("a=(5 6 7); i=1; echo $(( a[i+1] * 2 )); (( a[0] += 1 )); echo ${a[0]}")).toBe("14\n6\n");
  });
  it("namerefs", () => {
    expect(out("set_it() { declare -n ref=$1; ref=changed; }; v=orig; set_it v; echo $v")).toBe("changed\n");
  });
});

describe("io", () => {
  it("redirection and pipes", () => {
    expect(out("echo hi > /tmp/f; echo there >> /tmp/f; wc -l < /tmp/f; cat /tmp/f")).toBe("2\nhi\nthere\n");
    expect(out("ls /nope 2>&1 | wc -l")).toBe("1\n");
    expect(out("ls /nope > /dev/null 2>&1; echo $?")).toBe("2\n");
    expect(run("ls /nope 2>/dev/null").stderr).toBe("");
    expect(out("printf 'b\\na\\nc\\n' | sort | head -n 2")).toBe("a\nb\n");
    expect(out("cat <<EOF\nhello $USER\nEOF")).toBe("hello learner\n");
    expect(out("cat <<'EOF'\nhello $USER\nEOF")).toBe("hello $USER\n");
    expect(out("tr a-z A-Z <<< hello")).toBe("HELLO\n");
    expect(out("diff <(echo a) <(echo b) | head -1")).toBe("1c1\n");
    expect(out("{ echo a; echo b; } > /tmp/g; cat /tmp/g")).toBe("a\nb\n");
    expect(out('echo x | read v; echo "[$v]"')).toBe("[]\n");
    expect(out("false | true; echo $?; set -o pipefail; false | true; echo $?")).toBe("0\n1\n");
    expect(out("true | false | true; echo ${PIPESTATUS[@]}")).toBe("0 1 0\n");
  });
  it("exec and fds", () => {
    expect(out("exec 3>/tmp/log; echo one >&3; echo two >&3; exec 3>&-; cat /tmp/log")).toBe("one\ntwo\n");
  });
});

describe("errors and options", () => {
  it("exit codes", () => {
    const r = run("nosuchcmd; echo $?");
    expect(r.stdout).toBe("127\n");
    expect(r.stderr).toContain("nosuchcmd: command not found");
    expect(run("set -e; false; echo no").stdout).toBe("");
    expect(run("set -e; false; echo no").status).toBe(1);
    expect(run("set -e; if false; then :; fi; false || true; echo yes").stdout).toBe("yes\n");
    expect(run("set -u; echo $nope").stderr).toContain("nope: unbound variable");
    expect(run("readonly r=1; r=2").stderr).toContain("r: readonly variable");
    expect(run("exit 7").status).toBe(7);
  });
  it("xtrace", () => {
    const r = run('set -x; x="a b"; echo $x');
    expect(r.stderr).toBe("+ x='a b'\n+ echo a b\n");
  });
  it("trap", () => {
    expect(out("trap 'echo cleanup' EXIT; echo work")).toBe("work\ncleanup\n");
    expect(out("trap 'echo got USR1' USR1; kill -USR1 $$; echo after")).toBe("got USR1\nafter\n");
  });
  it("subshells", () => {
    expect(out("x=1; (x=2; echo $x); echo $x")).toBe("2\n1\n");
    expect(out("cd /tmp; (cd /; pwd); pwd")).toBe("/\n/tmp\n");
  });
  it("getopts", () => {
    const code =
      'while getopts "vo:" opt; do case $opt in v) echo verbose;; o) echo "out=$OPTARG";; ?) echo bad;; esac; done; shift $((OPTIND-1)); echo "rest=$*"';
    expect(out(code, { args: "-v -o file.txt extra" })).toBe("verbose\nout=file.txt\nrest=extra\n");
    expect(out(code, { args: "-vofile x" })).toBe("verbose\nout=file\nrest=x\n");
  });
  it("read", () => {
    expect(out("read -r a b <<< 'one two three'; echo \"$a|$b\"")).toBe("one|two three\n");
    expect(out("printf 'last' | { read -r l; echo \"$? [$l]\"; }")).toBe("1 [last]\n");
  });
});

describe("utilities", () => {
  it("text tools", () => {
    expect(out("grep -c ERROR logs/app.log")).toBe("3\n");
    expect(out("grep -i 'gateway' logs/app.log | wc -l")).toBe("2\n");
    expect(out("cut -d, -f2 data/users.csv | head -3")).toBe("name\nAlice Johnson\nBob Smith\n");
    expect(out("sort data/fruits.txt | uniq -c | sort -rn | head -1")).toBe("      3 apple\n");
    expect(out("awk -F, 'NR>1 {s+=$4} END {print s}' data/sales.csv")).toBe("133\n");
    expect(out("awk -F, 'NR>1 {u[$2]+=$4} END {for (r in u) print r, u[r]}' data/sales.csv | sort")).toBe(
      "east 26\nnorth 40\nsouth 19\nwest 48\n",
    );
    expect(out("echo hello | sed 's/l/L/g'")).toBe("heLLo\n");
    expect(out("printf 'a\\nb\\nc\\n' | sed -n '2p'")).toBe("b\n");
    expect(out("echo 'John Smith' | sed -E 's/(\\w+) (\\w+)/\\2, \\1/'")).toBe("Smith, John\n");
    expect(out("echo hello | tr a-z A-Z")).toBe("HELLO\n");
    expect(out("wc -l data/numbers.txt")).toBe("8 data/numbers.txt\n");
    expect(out("sort -n data/numbers.txt | tail -1")).toBe("100\n");
    expect(out("sort -t, -k4 -n data/sales.csv | tail -1")).toBe("2026-10-03,west,lamp,20,24.50\n");
    expect(out("printf '%5.2f|%-5s|%03d\\n' 3.14159 ab 7")).toBe(" 3.14|ab   |007\n");
    expect(out("seq 3 | paste -sd+")).toBe("1+2+3\n");
    expect(out("echo a b c | xargs -n1 echo item")).toBe("item a\nitem b\nitem c\n");
    expect(out("diff data/old.txt data/new.txt")).toBe("3c3\n< gamma\n---\n> GAMMA\n4a5\n> epsilon\n");
  });
  it("file tools", () => {
    expect(out("ls data")).toBe(
      "config.ini\nfruits.txt\ninventory.json\nnew.txt\nnumbers.txt\nold.txt\nsales.csv\nservers.txt\nusers.csv\n",
    );
    expect(out("find projects -name '*.sh' | sort")).toBe(
      "projects/scripts/backup.sh\nprojects/scripts/broken.sh\nprojects/scripts/deploy.sh\nprojects/scripts/greet.sh\n",
    );
    expect(out("mkdir -p a/b/c && touch a/b/c/f && find a -type f")).toBe("a/b/c/f\n");
    expect(out("cp notes.txt /tmp/n && mv /tmp/n /tmp/m && ls /tmp")).toBe("m\n");
    expect(out("basename /a/b/file.txt .txt; dirname /a/b/file.txt")).toBe("file\n/a/b\n");
    expect(run("rm data").stderr).toContain("Is a directory");
    expect(run("cat /etc/shadow").stderr).toContain("Permission denied");
    expect(out("./projects/scripts/greet.sh Ada Linus")).toBe("Hello, Ada!\nHello, Linus!\n");
    expect(run("./projects/scripts/deploy.sh").stderr).toContain("Permission denied");
    expect(out("chmod +x projects/scripts/deploy.sh && ./projects/scripts/deploy.sh v2")).toBe("Deploying version v2...\n");
    expect(out("type cd; type ls; type if")).toBe("cd is a shell builtin\nls is /usr/bin/ls\nif is a shell keyword\n");
    expect(out("bash -c 'echo $0 $1' prog arg")).toBe("prog arg\n");
    expect(out("x=1; export y=2; bash -c 'echo [$x] [$y]'")).toBe("[] [2]\n");
  });
});

describe("interactive session", () => {
  it("prompt, aliases, history, completion", () => {
    const s = new ShellSession();
    expect(s.prompt()).toContain("learner@bash-mastery");
    const r = s.run("ll -d data");
    expect(r.chunks.map((c) => c.text).join("")).toContain("data");
    s.run("echo first");
    const h = s.run("!!");
    expect(h.echoed).toBe("echo first");
    expect(s.needsMore("for i in 1 2; do")).toBe(true);
    expect(s.needsMore("echo 'open")).toBe(true);
    expect(s.needsMore("echo done")).toBe(false);
    expect(s.complete("cat da").candidates).toEqual(["data/"]);
    expect(s.complete("gre").candidates).toContain("grep");
  });
  it("infinite loops are stopped", () => {
    const r = run("while true; do :; done");
    expect(r.stderr).toContain("infinite loop");
  });
});
