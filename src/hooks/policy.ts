import { basename, extname } from "node:path";
import { createLanguageScanner } from "../language.js";
import { scanLines } from "../references.js";

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

export function evaluateBash(command: string): Violation[] {
  const out: Violation[] = [];

  // SEC-001/003: ler ou versionar .env / chaves. `.gitignore` e `.env.example` são ok.
  if (!/\.gitignore\b/.test(command)) {
    for (const m of command.matchAll(SENSITIVE_TOKEN)) {
      if (!isSensitivePath(m[2])) continue;
      out.push(v("SEC-001", "deny", `O comando toca "${m[2]}" (dado sensível; SEC-001/SEC-003). Use o .env.example ou peça ao usuário.`));
      break;
    }
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
const DEP_LINE = /^\s*"(@?[\w./-]+)"\s*:\s*"(?:[\^~<>=]*\d[\w.\-+*xX ]*|\*|latest|workspace:[^"]*|npm:[^"]*|git[^"]*|https?:[^"]*)"\s*,?\s*$/;

export function evaluateWrite(input: WriteInput): Violation[] {
  return evaluateAddedLines(input.path, addedLines(input.before, input.after), input.root);
}

/** Avalia só as linhas adicionadas a um arquivo (usado por Write/Edit e pelo gate do Stop, que lê o diff). */
export function evaluateAddedLines(path: string, added: { n: number; text: string }[], root?: string): Violation[] {
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
  for (const { n, text } of added)
    if (LINT_DISABLE.test(text)) {
      out.push(v("TEST-003", "ask", `${file}:${n} desabilita lint/checagem de tipos. Não faça isso para fazer algo passar (TEST-003). Prefira @ts-expect-error com motivo, se inevitável.`));
      break;
    }

  // DEP-001: dependência adicionada direto no package.json
  if (file === "package.json")
    for (const { n, text } of added)
      if (DEP_LINE.test(text)) {
        out.push(v("DEP-001", "ask", `package.json:${n} adiciona/altera dependência. Verifique DEP-001, DEP-006 e informe o motivo (DEP-003); major só com pedido (DEP-005).`));
        break;
      }

  // DOC-*, SCOPE-001: referências indevidas em comentários (erros bloqueiam; alertas só informam)
  for (const f of scanLines(path, added, ext)) out.push(v(f.rule, f.severity === "error" ? "deny" : "warn", `${file}:${f.line} ${f.message}`));

  // LANG-*: heurístico, nunca bloqueia
  const lang = createLanguageScanner(root ?? path);
  for (const f of lang.scan(path, added)) out.push(v(f.rule, "warn", `${file}:${f.line} ${f.message}`));
  return out;
}
