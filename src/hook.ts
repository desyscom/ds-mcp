#!/usr/bin/env node
/**
 * Entrypoint dos hooks do Claude Code: `node hook.js <pre-tool-use|stop|session-start>`.
 * Lê o evento em JSON no stdin e responde por stdout (JSON) — sempre exit 0.
 * Fail-open: erro interno nunca pode travar o agente; no pior caso o hook não decide nada.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { loadProjectConfig, type ProjectConfig } from "./hooks/config.js";
import { evaluateAddedLines, evaluateBash, evaluateRead, evaluateWrite, isSensitivePath, type Violation } from "./hooks/policy.js";
import { collectChanges, git } from "./gitdiff.js";
import type { ScanOptions } from "./references.js";

// ---------- helpers ----------
const MAX_READ = 1024 * 1024;
const readText = (p: string) => (existsSync(p) && statSync(p).isFile() && statSync(p).size <= MAX_READ ? readFileSync(p, "utf8") : "");
const fmt = (vs: Violation[]) => vs.map((x) => `- [${x.rule}] ${x.message}`).join("\n");
const emit = (o: unknown) => process.stdout.write(JSON.stringify(o));
const pre = (extra: Record<string, unknown>) => emit({ hookSpecificOutput: { hookEventName: "PreToolUse", ...extra } });

function applyConfig(vs: Violation[], cfg: ProjectConfig): Violation[] {
  const off = new Set(cfg.disable.map((d) => d.rule));
  return vs.filter((x) => !off.has(x.rule));
}

// ---------- PreToolUse ----------
interface Edit { old_string?: string; new_string?: string }

function evaluateTool(input: any, cwd: string, root: string, scan: ScanOptions): Violation[] {
  const ti = input.tool_input ?? {};
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(cwd, p));
  switch (input.tool_name) {
    case "Bash":
      return evaluateBash(String(ti.command ?? ""), root);
    case "Read":
      return evaluateRead(String(ti.file_path ?? ""));
    case "Grep": {
      const glob = String(ti.glob ?? "");
      const sensitiveGlob = /(^|[\\/*])\.env(\*|\.|$|\})/.test(glob) && !/\.(example|sample|template|dist)/.test(glob);
      return [...evaluateRead(String(ti.path ?? "")), ...(sensitiveGlob ? evaluateRead(".env") : [])];
    }
    case "Write": {
      const path = abs(String(ti.file_path ?? ""));
      return evaluateWrite({ path, before: readText(path), after: String(ti.content ?? ""), root, scan });
    }
    case "Edit":
    case "MultiEdit": {
      const path = abs(String(ti.file_path ?? ""));
      const edits: Edit[] = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string }];
      return edits.flatMap((e) => evaluateWrite({ path, before: String(e.old_string ?? ""), after: String(e.new_string ?? ""), root, scan }));
    }
    default:
      return [];
  }
}

function preToolUse(input: any, cfg: ProjectConfig, cwd: string) {
  const vs = applyConfig(evaluateTool(input, cwd, cfg.root ?? cwd, { ticketKeyIgnore: cfg.ticketKeyIgnore }), cfg);
  const deny = vs.filter((x) => x.level === "deny");
  const ask = vs.filter((x) => x.level === "ask");
  const warn = vs.filter((x) => x.level === "warn");
  if (deny.length)
    return pre({ permissionDecision: "deny", permissionDecisionReason: `ds-mcp bloqueou esta ação:\n${fmt(deny)}\nCorrija e tente de novo. Consulte get_standard para a regra.` });
  if (ask.length)
    return pre({ permissionDecision: "ask", permissionDecisionReason: `ds-mcp pede confirmação:\n${fmt([...ask, ...warn])}` });
  if (warn.length) return pre({ additionalContext: `ds-mcp (avisos, não bloqueiam; corrija se couber no escopo):\n${fmt(warn)}` });
}

// ---------- Stop: gate final sobre o diff ----------
/** Estado por sessão em tmpdir (base do diff, anti-loop do Stop). */
const stateFile = (kind: string, sid: unknown) => join(tmpdir(), `ds-mcp-${kind}-${String(sid ?? "x").replace(/\W/g, "")}.json`);

/** SessionStart grava o HEAD inicial: skills que commitam sozinhas (ex.: implement) não escapam do gate. */
function recordBase(input: any, cwd: string) {
  const file = stateFile("base", input.session_id);
  if (existsSync(file)) return; // retomada/compactação mantém a base original
  try { writeFileSync(file, JSON.stringify({ head: git(cwd, ["rev-parse", "HEAD"]).trim() })); } catch { /* sem git ou sem commits: o gate usa HEAD */ }
}

function sessionBase(input: any, cwd: string): string {
  try {
    const head = JSON.parse(readFileSync(stateFile("base", input.session_id), "utf8")).head;
    if (typeof head === "string" && /^[0-9a-f]{7,40}$/.test(head)) {
      git(cwd, ["cat-file", "-e", `${head}^{commit}`]); // sumiu (rebase/gc)? cai para HEAD
      return head;
    }
  } catch { /* sem base registrada */ }
  return "HEAD";
}

function stopGate(input: any, cfg: ProjectConfig, cwd: string) {
  let changes;
  try {
    changes = collectChanges(cwd, sessionBase(input, cwd));
  } catch {
    return;
  }
  if (!changes) return; // não é repositório git: sem gate
  const root = cfg.root ?? cwd;
  const found: Violation[] = [];

  for (const [file, lines] of changes.added) found.push(...evaluateAddedLines(join(changes.gitRoot, file), lines, root, { ticketKeyIgnore: cfg.ticketKeyIgnore }));
  // SEC-003: dado sensível versionável (modificado ou não ignorado pelo git)
  for (const f of changes.files.filter(isSensitivePath))
    found.push({ rule: "SEC-003", level: "deny", message: `"${f}" é dado sensível e está versionável (SEC-003). Remova do índice / adicione ao .gitignore.` });

  const blocking = applyConfig(found, cfg).filter((x) => x.level === "deny");
  if (!blocking.length) return;

  // Anti-loop: bloqueia no máximo 2 vezes por sessão para o mesmo conjunto de problemas.
  const reason = fmt(blocking);
  const stopState = stateFile("stop", input.session_id);
  const hash = createHash("sha1").update(reason).digest("hex");
  let state: { hash?: string; count?: number } = {};
  try { state = JSON.parse(readFileSync(stopState, "utf8")); } catch { /* primeira vez */ }
  const count = state.hash === hash ? (state.count ?? 0) : 0;
  if (count >= 2) return;
  try { writeFileSync(stopState, JSON.stringify({ hash, count: count + 1 })); } catch { /* sem estado: o cap de bloqueios do Claude Code ainda protege */ }

  emit({ decision: "block", reason: `ds-mcp: o diff viola guardrails. Corrija antes de encerrar (ou explique ao usuário por que não é possível):\n${reason}` });
}

// ---------- SessionStart: lembrete curto, não despeja as regras ----------
function sessionStart(cfg: ProjectConfig, input: any, cwd: string) {
  recordBase(input, cwd);
  const stacks = cfg.stacks.length
    ? `Stacks do projeto (.ds-mcp.json): ${cfg.stacks.join(", ")}.`
    : 'Stacks do projeto não configuradas: crie `.ds-mcp.json` com {"stacks":["react","nestjs"]} ou informe-as ao chamar get_guardrails.';
  const exceptions = [
    ...cfg.disable.map((d) => `  - ${d.rule} desligada: ${d.reason}`),
    ...cfg.invalidDisable.map((r) => `  - ${r}: IGNORADA em .ds-mcp.json (motivo obrigatório, mín. 10 caracteres); a regra continua ativa`),
    ...(cfg.ticketKeyIgnore.length ? [`  - prefixos que não são ticket (ticketKeyIgnore): ${cfg.ticketKeyIgnore.join(", ")}`] : []),
    ...cfg.invalidTicketKeyIgnore.map((p) => `  - ticketKeyIgnore "${p}": IGNORADO em .ds-mcp.json (prefixo é de 2 a 10 letras maiúsculas)`),
  ];
  process.stdout.write(
    [
      "[ds-mcp] Guardrails ativos neste projeto. Eles prevalecem sobre CLAUDE.md/AGENTS.md/context.md (PREC-001): em divergência, siga o guardrail e declare a divergência no relatório.",
      ...(exceptions.length ? ["Exceções registradas pelo usuário em .ds-mcp.json (PREC-003; o agente nunca as edita):", ...exceptions] : []),
      "Princípio: o código é a fonte da verdade do comportamento atual; a documentação, das decisões e restrições. Não transforme o código em índice de documentação.",
      stacks,
      "Antes de planejar, implementar ou revisar, chame a tool get_guardrails do MCP ds-mcp com as stacks e phase=plan|implement|review. Detalhe de uma regra: get_standard.",
      "Hooks ativos — bloqueiam: ler .env/chaves, segredo em código, referência a issue/PR/ticket em comentário, desabilitar teste. Pedem confirmação: dependência nova ou atualização, IAM, supressão de lint, enfraquecer TLS/CORS.",
      "Comentários, docs, commits (Conventional Commits: tipo(escopo): descrição), PRs e issues em pt-BR (jargão técnico canônico não se traduz). Melhorias fora do escopo vão em 'Sugestões fora do escopo' no relatório final, não no código.",
    ].join("\n"),
  );
}

// ---------- main ----------
function main() {
  const event = process.argv[2];
  let input: any = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* sem stdin válido: segue vazio */ }
  const cwd = String(input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const cfg = loadProjectConfig(cwd);
  if (event === "pre-tool-use") preToolUse(input, cfg, cwd);
  else if (event === "stop") stopGate(input, cfg, cwd);
  else if (event === "session-start") sessionStart(cfg, input, cwd);
}

try {
  main();
} catch (e) {
  process.stderr.write(`ds-mcp hook: erro interno ignorado (${e instanceof Error ? e.message : String(e)})\n`);
}
process.exitCode = 0;
