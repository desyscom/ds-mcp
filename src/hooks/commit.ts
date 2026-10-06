/** Extrai as mensagens de `git commit` de um comando Bash (inclui o formato heredoc que o Claude Code usa). */

const HEREDOC = /\$\(\s*cat\s*<<-?\s*(['"]?)(\w+)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?[ \t]*\)/g;

/** Divide em tokens respeitando aspas simples e duplas; `&&`, `||`, `;` e `|` viram tokens próprios. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let open = false;
  const flush = () => {
    if (open || cur) out.push(cur);
    cur = "";
    open = false;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j < 0 ? cmd.length : j;
      cur += cmd.slice(i + 1, end);
      open = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === "\\" && j + 1 < cmd.length) j++;
        cur += cmd[j];
        j++;
      }
      open = true;
      i = j;
    } else if (/\s/.test(c)) {
      flush();
    } else if (c === "&" || c === "|" || c === ";") {
      flush();
      let op = c;
      if ((c === "&" || c === "|") && cmd[i + 1] === c) {
        op = c + c;
        i++;
      }
      out.push(op);
    } else {
      cur += c;
    }
  }
  flush();
  return out;
}

const SEPARATORS = new Set(["&&", "||", ";", "|", "&"]);

export interface Commit {
  /** mensagens dadas por -m / --message, na ordem (a primeira linha da primeira é o assunto) */
  messages: string[];
}

export function parseCommits(command: string): Commit[] {
  const bodies: string[] = [];
  const simplified = command.replace(HEREDOC, (_m, _q, _id, body: string) => {
    bodies.push(body);
    return `"__HEREDOC_${bodies.length - 1}__"`;
  });
  const restore = (t: string) => t.replace(/__HEREDOC_(\d+)__/g, (_m, n: string) => bodies[Number(n)] ?? "");

  const tokens = tokenize(simplified);
  const commits: Commit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "git") continue;
    // pula opções globais do git: -C <dir>, -c k=v, --no-pager...
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith("-")) j += tokens[j] === "-C" || tokens[j] === "-c" ? 2 : 1;
    if (tokens[j] !== "commit") continue;

    const messages: string[] = [];
    for (let k = j + 1; k < tokens.length && !SEPARATORS.has(tokens[k]); k++) {
      const t = tokens[k];
      if (/^-[a-zA-Z]*m$/.test(t) || t === "--message") {
        if (k + 1 < tokens.length) messages.push(restore(tokens[++k]));
      } else if (t.startsWith("--message=")) {
        messages.push(restore(t.slice("--message=".length)));
      }
    }
    commits.push({ messages });
    i = j;
  }
  return commits;
}
