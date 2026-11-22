---
objectives:
  - Feed multi-line text to a command with a here document (`<<`)
  - Control expansion inside here documents by quoting the delimiter
  - Indent here documents with `<<-` and tabs
  - Pass a single string as stdin with a here string (`<<<`)
summary:
  - "`cmd <<EOF … EOF` sends the lines between the markers to cmd's stdin."
  - "With an unquoted delimiter, `$var`, `$(cmd)` and `$((…))` are expanded; with `<<'EOF'` the text is literal."
  - "`<<-EOF` strips leading **tabs** (not spaces) so the block can be indented in scripts."
  - "`cmd <<< \"$text\"` sends one string (plus a newline) to stdin — a cleaner alternative to `echo | cmd`."
  - "Here documents are ideal for generating config files, multi-line messages, SQL and remote scripts."
related:
  - redirection
  - quoting
  - deployment-scripts
---

## Inline input

Sometimes a command needs several lines of input that you'd rather keep inside your script than in a separate file. A **here document** does that:

```bash title="heredoc.sh" playground
cat <<EOF
Dear $USER,
Your disk usage report was generated on $(date +%F).
Have a great day.
EOF
```

`<<EOF` means "read the following lines as standard input, until a line containing exactly `EOF`". The delimiter can be any word — `EOF`, `END`, `SQL`, `CONFIG` — chosen so it doesn't appear in the text.

The terminating line must contain **only** the delimiter: no leading spaces (unless you use `<<-` with tabs) and no trailing spaces.

## Expansion or literal?

| Form | Inside the document |
|---|---|
| `<<EOF` | `$var`, `$(cmd)`, `$((…))` and `\` escapes are processed |
| `<<'EOF'` or `<<"EOF"` or `<<\EOF` | everything is literal |

Use a quoted delimiter when the text itself contains `$` — scripts you generate, templates, documentation:

```bash title="literal.sh" playground
cat <<'SCRIPT' > /tmp/hello.sh
#!/usr/bin/env bash
echo "Hello, $USER — today is $(date +%A)"
SCRIPT
cat /tmp/hello.sh
bash /tmp/hello.sh
```

With an unquoted delimiter you can still protect individual characters with a backslash: `\$HOME` stays literal.

## Indented here documents

Inside functions and loops, a flush-left here document looks messy. `<<-` removes leading **tab** characters from each line and from the delimiter line:

```bash
deploy() {
	cat <<-EOF
		Deploying $1
		  - step one
	EOF
}
```

It only strips tabs, not spaces — and many editors convert tabs to spaces, which silently breaks the delimiter. Many people prefer flush-left blocks for that reason.

## Common uses

```bash title="uses.sh" playground
# 1. Generate a config file from variables
app=shop port=8080
cat > /tmp/app.ini <<EOF
[server]
name=$app
port=$port
EOF
cat /tmp/app.ini

# 2. Feed a program that reads stdin
sort <<EOF
pear
apple
fig
EOF

# 3. A multi-line usage message
usage() {
cat <<EOF >&2
Usage: $0 [-v] FILE...
  -v   verbose output
EOF
}
usage
```

Other everyday cases: SQL passed to `psql` or `mysql`, a script run on a remote machine with `ssh host bash <<'EOF'`, and multi-line commit messages.

## Here strings

A **here string** `<<<` passes a single string, followed by a newline, to stdin:

```bash title="herestring.sh" playground
tr a-z A-Z <<< "hello world"
read -r first rest <<< "one two three"
echo "first=$first rest=$rest"
wc -w <<< "$(cat ~/notes.txt)"
bc_like=$(( $(wc -l <<< $'a\nb\nc') * 2 ))
echo "$bc_like"
```

Compared with `echo "$x" | cmd`, a here string avoids `echo`'s quirks and doesn't create a pipeline, so `read` sets variables in the current shell. It's a Bash/ksh/zsh feature, not POSIX.

## Common mistakes

```mistake
title: An indented terminator
wrong: |
  if true; then
    cat <<EOF
    text
    EOF          # not recognised: the line contains spaces
  fi
right: |
  if true; then
    cat <<EOF
    text
  EOF
  fi
why: The delimiter line must match exactly. Only `<<-` strips leading tabs (never spaces).
```

```mistake
title: Unintended expansion
wrong: |
  cat > deploy.sh <<EOF
  echo "Deploying to $TARGET"    # $TARGET is expanded NOW, probably to nothing
  EOF
right: |
  cat > deploy.sh <<'EOF'
  echo "Deploying to $TARGET"
  EOF
why: With an unquoted delimiter, the shell expands variables when the here document is read. Quote the delimiter to write the text literally.
```

## Practice

```exercise
kind: predict
difficulty: beginner
prompt: What does this print?
code: |
  name=world
  cat <<EOF
  hello $name
  EOF
  cat <<'EOF'
  hello $name
  EOF
answer: |
  hello world
  hello $name
explanation: The first delimiter is unquoted, so `$name` expands; the quoted delimiter keeps the text literal.
```

```exercise
kind: command
difficulty: beginner
prompt: "Using a here string, convert the text `bash rocks` to upper case with `tr`."
solution: tr a-z A-Z <<< "bash rocks"
explanation: "`<<<` feeds the string to tr's stdin."
```

```exercise
kind: predict
difficulty: intermediate
prompt: What does this print?
code: |
  read -r a b <<< "  alpha   beta gamma  "
  echo "[$a] [$b]"
answer: "[alpha] [beta gamma]"
explanation: "`read` trims leading and trailing whitespace; the last variable receives the rest of the line."
```

## Challenge

```exercise
kind: script
difficulty: intermediate
title: Generate a systemd unit
prompt: "Complete the script so it writes a unit file to `/tmp/myapp.service` using a here document, with the variables expanded, then prints the file. Expected output is shown when you check."
starter: |
  #!/usr/bin/env bash
  name=myapp
  user=deploy
  bin=/opt/myapp/bin/server
  # write /tmp/$name.service here

  cat "/tmp/$name.service"
solution: |
  #!/usr/bin/env bash
  name=myapp
  user=deploy
  bin=/opt/myapp/bin/server
  cat > "/tmp/$name.service" <<EOF
  [Unit]
  Description=$name service

  [Service]
  User=$user
  ExecStart=$bin
  Restart=on-failure
  EOF

  cat "/tmp/$name.service"
expectedOutput: |
  [Unit]
  Description=myapp service

  [Service]
  User=deploy
  ExecStart=/opt/myapp/bin/server
  Restart=on-failure
checks:
  - pattern: <<\s*-?\s*EOF
    message: Use a here document with an EOF (or similar) delimiter.
hints:
  - "`cat > \"/tmp/$name.service\" <<EOF` … `EOF`"
  - Leave the delimiter unquoted so the variables are expanded.
explanation: "An unquoted here document is a template: variables are filled in as the file is written. This is how many provisioning scripts generate config files."
```
