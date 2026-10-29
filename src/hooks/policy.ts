import { basename, extname } from "node:path";
import { createLanguageScanner } from "../language.js";
import { scanLines, type ScanOptions } from "../references.js";
import { parseCommits } from "./commit.js";

/**
 * Política dos hooks: funções puras (entrada → violações). Nada aqui conhece o protocolo do Claude Code.
 *  deny = bloqueia (determinístico, quase sem falso positivo)
 *  ask  = pede confirmação ao usuário (checkpoint humano)
 *  warn = só informa o agente depois (heurístico)
 */
export type Level = "deny" | "ask" | "warn";
export interface Violation {
  rule: string;
  level: Level;
  message: string;
}

const v = (rule: string, level: Level, message: string): Violation => ({ rule, level, message });

// ---------- caminhos sensíveis (SEC-001, SEC-003, glossário: dado sensível) ----------
const ENV_FILE = /(^|[\\/])\.env(\.[\w-]+)*$/i;
const ENV_SAFE = /\.(example|sample|template|dist)$/i;
const KEY_FILE = /(\.(pem|key|pfx|p12|keystore|jks)$)|((^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$)/i;

export function isSensitivePath(p: string): boolean {
  if (ENV_SAFE.test(p)) return false;
  return ENV_FILE.test(p) || (KEY_FILE.test(p) && !/\.pub$/i.test(p));
}

export function evaluateRead(path: string): Violation[] {
  return isSensitivePath(path)
    ? [v("SEC-001", "deny", `"${basename(path)}" é dado sensível (SEC-001/SEC-003). Não leia o conteúdo: use o .env.example, ou peça ao usuário o que precisa saber.`)]
    : [];
}

// ---------- Bash ----------
const SENSITIVE_TOKEN = /(^|[\s'"=/\\])(\.env(\.[\w-]+)*|[\w./\\-]*\.(pem|key|pfx|p12|keystore|jks)|[\w./\\-]*id_(rsa|dsa|ecdsa|ed25519))(?=$|[\s'";|&)<>])/gi;
const CONFIG_FILE = /(^|[\\/])\.ds-mcp\.json$/;
const CLAUDE_SETTINGS = /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/;
const HOOK_SWITCH = /disableAllHooks|enabledPlugins|"hooks"/;
const TEST_FILE =/(\.(test|spec)\.[jt]sx?$)|(__tests__[\\/])|((^|[\\/])test_[\w-]+\.py$)|(_test\.(go|py)$)|(Tests?\.cs$)/i;

/**
 * Usos que carregam ou movem o arquivo sensível sem pôr o conteúdo no output nem num nome versionável. A lista é de
 * permissões: comando desconhecido que cite o arquivo continua bloqueado.
 */
const ENV_FILE_FLAG = /--env-file[=\s]+["']?$/;
const NO_CONTENT_CMD = new Set(["test", "[", "ls", "dir", "stat", "Test-Path", "source", "."]);
const COPY_CMD = new Set(["cp", "mv", "copy", "move", "Copy-Item", "Move-Item", "cpi", "mi"]);
const unquote = (s: string) => s.replace(/^['"]|['"]$/g, "");

/** Primeiro arquivo sensível que o segmento expõe (lê, versiona, copia para nome comum), ou null. */
function exposedSensitive(segment: string): string | null {
  const hits = [...segment.matchAll(SENSITIVE_TOKEN)].filter((m) => isSensitivePath(m[2]));
  if (!hits.length) return null;
  const words = segment.trim().split(/\s+/);
  const cmd = words[0] === "sudo" ? words[1] : words[0];
  if (NO_CONTENT_CMD.has(cmd)) return null;
  if (COPY_CMD.has(cmd)) {
    const args = words.slice(words.indexOf(cmd) + 1).filter((a) => !a.startsWith("-")).map(unquote);
    const dest = args[args.length - 1] ?? "";
    // o destino mantém o nome sensível: o .gitignore que cobre o original cobre a cópia
    if (args.length >= 2 && (isSensitivePath(dest) || /[\\/]$/.test(dest))) return null;
  }
  for (const m of hits) {
    const before = segment.slice(0, (m.index ?? 0) + m[1].length);
    if (ENV_FILE_FLAG.test(before) || (cmd === "dotenv" && /\s-e\s+["']?$/.test(before))) continue;
    return m[2];
  }
  return null;
}

/** O segmento instala um pacote *nomeado* (dependência nova)? `npm install` puro e `pip install -r` não contam. */
function installsPackage(segment: string): boolean {
  const t = segment.trim().split(/\s+/);
  const at = (names: string[]) => t.findIndex((x) => names.includes(x));
  const named = (from: number) => t.slice(from).filter((a) => !a.startsWith("-")).length > 0;

  const js = at(["npm", "pnpm", "bun"]);
  if (js === 0 && ["i", "install", "add"].includes(t[1] ?? "")) return named(2);
  if (t[0] === "yarn" && t[1] === "add") return true;

  const pip = at(["pip", "pip3"]);
  if (pip >= 0 && t[pip + 1] === "install") return !t.some((a) => ["-r", "--requirement", "-e", "--editable"].includes(a)) && named(pip + 2);

  if (["poetry", "uv", "cargo"].includes(t[0]) && t[1] === "add") return true;
  if (t[0] === "dotnet" && t[1] === "add" && t.includes("package")) return true;
  if (t[0] === "go" && t[1] === "get") return true;
  return false;
}

// ---------- mensagens de commit (COMMIT-001..003; LANG-001/002 no texto) ----------
const CC = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)\s]+\))?!?: \S/;
const CC_PREFIX = /^[a-z]+(\([^)]*\))?!?:\s*/;
const SKIP_SUBJECT = /^(Merge|Revert|fixup!|squash!|amend!)\b/;
// verbos que só existem em inglês (evita "remove"/"move"/"use", que também são pt-BR)
const EN_VERB = /^(add|adds|added|fix|fixes|fixed|update|updates|updated|implement|implements|create|creates|change|changes|improve|improves|support|supports|make|makes|allow|allows|handle|handles|rename|renames|bump|enable|enables|replace|replaces|prevent|prevents|ensure|ensures|initial)\b/i;

/** Avalia uma mensagem de commit já extraída (COMMIT-001..003 + idioma). */
export function evaluateCommitMessage(message: string, root?: string): Violation[] {
  const out: Violation[] = [];
  const lines = message.split(/\r?\n/);
  const subject = lines.find((l) => l.trim()) ?? "";
  if (SKIP_SUBJECT.test(subject)) return out;
  if (!CC.test(subject))
    out.push(v("COMMIT-001", "deny", `A mensagem de commit "${subject.slice(0, 60)}" não segue Conventional Commits: "tipo(escopo): descrição em pt-BR", ex.: "fix: corrige o total da venda".`));
  if (subject.length > 72) out.push(v("COMMIT-003", "warn", `Primeira linha do commit com ${subject.length} caracteres (máx. 72).`));
  if (EN_VERB.test(subject.replace(CC_PREFIX, "")))
    out.push(v("COMMIT-002", "warn", "A descrição do commit parece estar em inglês; use pt-BR (o tipo feat/fix permanece em inglês)."));
  const scanner = createLanguageScanner(root);
  for (const f of scanner.scan("COMMIT_EDITMSG.md", lines.map((text, i) => ({ n: i + 1, text }))))
    out.push(v(f.rule, "warn", `mensagem de commit, linha ${f.line}: ${f.message}`));
  return out;
}

/** Avalia os `git commit -m ...` de um comando Bash (hook PreToolUse). */
export function evaluateCommit(command: string, root?: string): Violation[] {
  return parseCommits(command)
    .filter((c) => c.messages.length > 0) // --amend --no-edit, -F arquivo: nada a avaliar
    .flatMap((c) => evaluateCommitMessage(c.messages.join("\n\n"), root));
}

export function evaluateBash(command: string, root?: string): Violation[] {
  const out: Violation[] = [];

  // SEC-001/003: ler ou versionar .env / chaves. `.gitignore` e `.env.example` são ok.
  if (!/\.gitignore\b/.test(command)) {
    const hit = command.split(/&&|\|\||;|\|/).map(exposedSensitive).find((t) => t !== null);
    if (hit)
      out.push(v("SEC-001", "deny", `O comando toca "${hit}" (dado sensível; SEC-001/SEC-003). Use o .env.example ou peça ao usuário. Carregar sem expor é permitido: --env-file, test/ls, source, ou cp/mv para outro arquivo sensível ou para um diretório terminado em "/".`));
  }
  // SEC-001: dump do ambiente expõe segredos
  if (/(^|[;&|]\s*)(printenv|env|set)\s*($|[;&|])/.test(command.trim()) || /\bGet-ChildItem\s+env:/i.test(command))
    out.push(v("SEC-001", "deny", "Listar todas as variáveis de ambiente pode expor segredos (SEC-001). Consulte uma variável específica e não a imprima."));

  // PREC-003: qualquer comando que não seja leitura e cite o arquivo de exceções ou os settings de hooks
  if (
    (/\.ds-mcp\.json/.test(command) && !/^\s*(cat|type|Get-Content|gc|ls|dir|grep|rg|head|tail)\b/.test(command)) ||
    (/\.claude[\\/]settings(\.local)?\.json/.test(command) && !/^\s*(cat|type|Get-Content|gc|ls|dir|grep|rg|head|tail)\b/.test(command))
  )
    out.push(v("PREC-003", "ask", "Altera o arquivo de exceções ou os settings de hooks. Só o usuário decide (PREC-003)."));

  // SEC-004: executar conteúdo obtido da rede
  if (/\b(curl|wget)\b[^|;]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i.test(command) || /\b(iex|Invoke-Expression)\b.*\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b/i.test(command))
    out.push(v("SEC-004", "ask", "Executa conteúdo baixado da rede sem inspeção (SEC-004)."));

  // SEC-007: permissões e acessos
  if (
    /\baws\s+iam\s+(attach|put|create|delete|update|detach|add|remove)/i.test(command) ||
    /\bgcloud\b.*\b(add|remove|set)-iam-policy-binding\b/i.test(command) ||
    /\baz\s+role\s+assignment\s+(create|delete)/i.test(command) ||
    /\bkubectl\s+(create|apply|delete)\s+.*\b(rolebinding|clusterrolebinding|role|clusterrole)\b/i.test(command) ||
    /\bchmod\s+(-R\s+)?(0?777|a\+rwx)\b/.test(command)
  )
    out.push(v("SEC-007", "ask", "Altera permissões/acessos (IAM, RBAC, chmod amplo). Requer autorização explícita (SEC-007)."));

  // DEP-001/003/006: dependência nova
  if (command.split(/&&|\|\||;|\|/).some(installsPackage)) out.push(v("DEP-001", "ask", "Adiciona dependência nova. Confirme que não existe no projeto (DEP-001), que não é problema trivial (DEP-006) e informe o motivo e a alternativa descartada no relatório (DEP-003)."));

  // DEP-004/005: atualizações
  if (
    /\b(npm|pnpm)\s+(update|up|upgrade|outdated\s+-u)\b/.test(command) ||
    /\byarn\s+(upgrade|up)\b/.test(command) ||
    /\b(ncu|npm-check-updates)\b.*(\s-u\b|--upgrade)/.test(command) ||
    /@latest\b/.test(command)
  )
    out.push(v("DEP-005", "ask", "Atualiza dependências (DEP-004: só as da tarefa; DEP-005: major só com pedido explícito)."));

  // TEST-005: remover teste
  if (/\b(rm|git\s+rm|del|Remove-Item|ri)\b/.test(command))
    for (const tok of command.split(/\s+/))
      if (TEST_FILE.test(tok.replace(/['"]/g, ""))) {
        out.push(v("TEST-005", "ask", `Remove o arquivo de teste "${tok}". Justifique a remoção (TEST-005).`));
        break;
      }
  out.push(...evaluateCommit(command, root));
  return out;
}

// ---------- Write / Edit ----------
export interface WriteInput {
  path: string;
  /** conteúdo anterior (Edit: old_string; Write: arquivo existente). Linhas que já existiam não são avaliadas. */
  before: string;
  /** conteúdo novo */
  after: string;
  /** raiz do projeto, para achar docs/glossary.md */
  root?: string;
  /** `ticketKeyIgnore` e `decisionIdPrefixes` do `.ds-mcp.json` */
  scan?: ScanOptions;
}

/** Linhas de `after` que não existiam em `before` (comparação por linha com trim). */
export function addedLines(before: string, after: string): { n: number; text: string }[] {
  const old = new Set(before.split(/\r?\n/).map((l) => l.trim()));
  return after
    .split(/\r?\n/)
    .map((text, i) => ({ n: i + 1, text }))
    .filter((l) => l.text.trim() !== "" && !old.has(l.text.trim()));
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ["chave privada", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["token GitHub", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["token Slack", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["chave Stripe live", /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/],
  ["chave Google API", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const GENERIC_SECRET = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i;
const PLACEHOLDER = /(x{3,}|your[_-]|changeme|change-me|example|placeholder|dummy|<[^>]+>|\$\{|process\.env|\*{3,})/i;

const SECURITY_WEAKENING = /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|origin\s*:\s*["']\*["']|--no-verify-ssl|strict-ssl\s*[=:]\s*false/;
const TEST_DISABLE = /\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe|test)\s*\(|\.only\s*\(|pytest\.mark\.(skip|xfail)|@pytest\.mark\.skip|@Ignore\b|\[Ignore\]|\bt\.Skip\s*\(|@Disabled\b/;
const LINT_DISABLE = /eslint-disable|@ts-ignore|@ts-nocheck|#\s*noqa\b|\/\/\s*nolint\b|#pragma warning disable|#\s*type:\s*ignore\b/;
const MIN_SUPPRESSION_REASON = 10;

/**
 * A supressão traz o motivo na mesma linha, na forma de cada ferramenta: `-- motivo` no ESLint, `// motivo` depois
 * do `#pragma` do C# e do `//nolint` do Go, `# motivo` depois do `noqa` e do `type: ignore`, e o texto livre que o
 * TypeScript aceita depois do `@ts-ignore`.
 */
function hasSuppressionReason(text: string): boolean {
  const m = LINT_DISABLE.exec(text);
  if (!m) return false;
  const rest = text.slice(m.index + m[0].length).replace(/\*\/\s*$/, "");
  const reason = m[0].startsWith("@ts-") ? rest.replace(/^[\s:-]+/, "") : (/(?:\s--\s|\/\/|#)(.*)$/.exec(rest)?.[1] ?? "");
  return reason.trim().length >= MIN_SUPPRESSION_REASON;
}

/** Forma da supressão com motivo na linguagem do arquivo. */
function suppressionHint(ext: string): string {
  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "prefira `// @ts-expect-error motivo`; no ESLint, `// eslint-disable-next-line regra -- motivo`";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "use `// eslint-disable-next-line regra -- motivo`";
  if (ext === ".cs") return "use `#pragma warning disable REGRA // motivo` e o `restore` logo depois";
  if (ext === ".py") return "use `# noqa: REGRA  # motivo` ou `# type: ignore[código]  # motivo`";
  if (ext === ".go") return "use `//nolint:regra // motivo`";
  return "ponha o motivo na mesma linha da supressão";
}
const DEP_LINE = /^\s*"(@?[\w./-]+)"\s*:\s*"(?:[\^~<>=]*\d[\w.\-+*xX ]*|\*|latest|workspace:[^"]*|npm:[^"]*|git[^"]*|https?:[^"]*)"\s*,?\s*$/;
const DEP_BLOCKS = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]);
/** Chaves de topo cujo valor tem forma de versão ou URL sem ser dependência. */
const PKG_META = new Set(["version", "homepage", "repository", "bugs", "funding", "license"]);

/**
 * Linhas de `source` que declaram dependência: dentro de um bloco de dependências, em qualquer nível. Um trecho de
 * Edit que não abre na raiz do JSON não diz em que bloco está; ali vale a linha solta, salvo chave de metadado.
 */
function dependencyLines(source: { n: number; text: string }[]): Set<number> {
  const out = new Set<number>();
  const fragment = !/^\s*\{/.test(source.find((l) => l.text.trim())?.text ?? "");
  const stack: string[] = [];
  for (const { n, text } of source) {
    const key = /^\s*"([^"]+)"\s*:/.exec(text)?.[1];
    if (key !== undefined && DEP_LINE.test(text)) {
      const inDeps = stack.some((k) => DEP_BLOCKS.has(k));
      if (inDeps || (fragment && stack.length === 0 && !PKG_META.has(key))) out.add(n);
    }
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    for (let i = 0; i < opens; i++) stack.push(i === 0 && key !== undefined ? key : "");
    for (let i = 0; i < closes; i++) stack.pop();
  }
  return out;
}

export function evaluateWrite(input: WriteInput): Violation[] {
  const source = input.after.split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
  return evaluateAddedLines(input.path, addedLines(input.before, input.after), input.root, input.scan, source);
}

/**
 * Avalia só as linhas adicionadas a um arquivo (usado por Write/Edit e pelo gate do Stop, que lê o diff).
 * `source` é o texto de onde `added` saiu, para o estado do bloco de comentário: o conteúdo do Write ou o `new_string`
 * do Edit. No Edit, linha nova dentro de um bloco aberto fora do trecho editado passa sem ser lida como comentário;
 * no Stop, sem `source`, o bloco só segue entre linhas adicionadas consecutivas.
 */
export function evaluateAddedLines(path: string, added: { n: number; text: string }[], root?: string, scan: ScanOptions = {}, source = added): Violation[] {
  const out: Violation[] = [];
  const file = basename(path);
  const ext = extname(path);
  if (added.length === 0) return out;

  // PREC-003: o agente não edita as próprias exceções nem desliga os hooks por conta própria
  if (CONFIG_FILE.test(path))
    out.push(v("PREC-003", "ask", `Altera "${file}", onde ficam as exceções aos guardrails. Só o usuário decide (PREC-003): sugira a mudança em vez de fazê-la.`));
  if (CLAUDE_SETTINGS.test(path) && added.some((l) => HOOK_SWITCH.test(l.text)))
    out.push(v("PREC-003", "ask", `Altera hooks/plugins em "${file}". Desligar guardrails é decisão do usuário (PREC-003).`));

  // SEC-003: editar .env (permitido, mas com confirmação); .env.example é livre
  if (isSensitivePath(path)) out.push(v("SEC-003", "ask", `Escreve em "${file}" (dado sensível). Valores reais nunca vão para arquivos versionados (SEC-003).`));

  // SEC-001/002: segredos no conteúdo
  if (!ENV_SAFE.test(path)) {
    for (const { n, text } of added) {
      const hit = SECRET_PATTERNS.find(([, re]) => re.test(text));
      if (hit) {
        out.push(v("SEC-002", "deny", `${file}:${n} parece conter ${hit[0]} (SEC-002). Use variável de ambiente ou secret manager.`));
        break;
      }
    }
    if (!out.some((x) => x.rule === "SEC-002"))
      for (const { n, text } of added)
        if (GENERIC_SECRET.test(text) && !PLACEHOLDER.test(text)) {
          out.push(v("SEC-002", "warn", `${file}:${n} parece atribuir um segredo literal (SEC-002). Se for real, use variável de ambiente.`));
          break;
        }
  }

  // SEC-005: enfraquecer controles de segurança
  for (const { n, text } of added)
    if (SECURITY_WEAKENING.test(text)) {
      out.push(v("SEC-005", "ask", `${file}:${n} enfraquece um controle de segurança (TLS/CORS). Não faça isso para testar ou depurar (SEC-005).`));
      break;
    }

  // TEST-003: desabilitar teste / lint
  if (TEST_FILE.test(path))
    for (const { n, text } of added)
      if (TEST_DISABLE.test(text)) {
        out.push(v("TEST-003", "deny", `${file}:${n} desabilita/isola teste (skip/only/xfail). Determine se o código está errado ou o comportamento mudou (TEST-003).`));
        break;
      }
  const suppressions = added.filter((l) => LINT_DISABLE.test(l.text));
  const bare = suppressions.find((l) => !hasSuppressionReason(l.text));
  if (bare)
    out.push(v("TEST-003", "ask", `${file}:${bare.n} desabilita lint/checagem de tipos sem motivo. Não faça isso para fazer algo passar (TEST-003). Se inevitável, ${suppressionHint(ext)}.`));
  else if (suppressions.length)
    out.push(v("TEST-003", "warn", `${file}:${suppressions[0].n} desabilita lint/checagem de tipos com motivo. Confirme que é inevitável e registre no relatório (TEST-003).`));

  // DEP-001: dependência adicionada direto no package.json
  if (file === "package.json") {
    const deps = dependencyLines(source);
    for (const { n } of added)
      if (deps.has(n)) {
        out.push(v("DEP-001", "ask", `package.json:${n} adiciona/altera dependência. Verifique DEP-001, DEP-006 e informe o motivo (DEP-003); major só com pedido (DEP-005).`));
        break;
      }
  }

  // DOC-*, SCOPE-001: referências indevidas em comentários (erros bloqueiam; alertas só informam)
  for (const f of scanLines(path, added, ext, scan, source)) out.push(v(f.rule, f.severity === "error" ? "deny" : "warn", `${file}:${f.line} ${f.message}`));

  // LANG-*: heurístico, nunca bloqueia
  const lang = createLanguageScanner(root ?? path);
  for (const f of lang.scan(path, added, source)) out.push(v(f.rule, "warn", `${file}:${f.line} ${f.message}`));
  return out;
}
