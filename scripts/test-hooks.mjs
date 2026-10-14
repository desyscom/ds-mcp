// Testa o protocolo dos hooks: stdin JSON → stdout JSON, sempre exit 0.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(process.cwd(), "dist", "hook.js");
let n = 0;

function run(event, input, raw) {
  const r = spawnSync("node", [HOOK, event], { input: raw ?? JSON.stringify(input), encoding: "utf8" });
  assert.equal(r.status, 0, `exit code deve ser 0, veio ${r.status}: ${r.stderr}`);
  n++;
  return r.stdout;
}
const json = (s) => JSON.parse(s);
const specific = (s) => json(s).hookSpecificOutput;

const proj = mkdtempSync(join(tmpdir(), "ds-hook-"));
writeFileSync(join(proj, ".ds-mcp.json"), JSON.stringify({ stacks: ["react", "nestjs"], disable: [] }));
const pre = (tool_name, tool_input, cwd = proj) => run("pre-tool-use", { hook_event_name: "PreToolUse", cwd, tool_name, tool_input });

// ---- PreToolUse: deny ----
let o = specific(pre("Read", { file_path: join(proj, ".env") }));
assert.equal(o.hookEventName, "PreToolUse");
assert.equal(o.permissionDecision, "deny");
assert.match(o.permissionDecisionReason, /SEC-001/);
assert.equal(specific(pre("Bash", { command: "cat .env.local" })).permissionDecision, "deny");
assert.equal(specific(pre("Grep", { pattern: "KEY", glob: ".env*" })).permissionDecision, "deny");
assert.equal(specific(pre("Write", { file_path: "src/a.ts", content: "// Corrige issue #481\nconst a = 1;" })).permissionDecision, "deny");
assert.equal(specific(pre("Edit", { file_path: "src/a.spec.ts", old_string: "it('a', f)", new_string: "it.skip('a', f)" })).permissionDecision, "deny");
assert.equal(specific(pre("MultiEdit", { file_path: "src/a.ts", edits: [{ old_string: "x", new_string: "const k = 'AKIAABCDEFGHIJKLMNOP';" }] })).permissionDecision, "deny");

// ---- PreToolUse: ask ----
o = specific(pre("Bash", { command: "npm install lodash" }));
assert.equal(o.permissionDecision, "ask");
assert.match(o.permissionDecisionReason, /DEP-001/);
assert.equal(specific(pre("Bash", { command: "aws iam attach-role-policy --role-name a --policy-arn b" })).permissionDecision, "ask");

// ---- PreToolUse: mensagem de commit ----
o = specific(pre("Bash", { command: 'git commit -m "added login"' }));
assert.equal(o.permissionDecision, "deny");
assert.match(o.permissionDecisionReason, /COMMIT-001/);
assert.equal(pre("Bash", { command: 'git commit -m "feat: adiciona o login"' }), "");
assert.equal(specific(pre("Bash", { command: "git commit -m \"$(cat <<'EOF'\nupdate stuff\nEOF\n)\"" })).permissionDecision, "deny");
assert.match(specific(pre("Bash", { command: 'git commit -m "feat: add login for users"' })).additionalContext, /COMMIT-002/);

// ---- PreToolUse: avisos viram contexto, não bloqueiam ----
o = specific(pre("Write", { file_path: "src/a.ts", content: "// Roda o teste de fumaça antes do deploy.\nconst a = 1;" }));
assert.equal(o.permissionDecision, undefined);
assert.match(o.additionalContext, /LANG-002/);

// ---- PreToolUse: não decide nada quando está tudo certo ----
assert.equal(pre("Bash", { command: "npm run test" }), "");
assert.equal(pre("Read", { file_path: join(proj, ".env.example") }), "");
assert.equal(pre("Write", { file_path: "src/a.ts", content: "// Usa o preço capturado na venda.\nconst a = 1;" }), "");
// O comentário avaliado é montado em runtime: escrito por extenso, o hook leria a linha deste teste como comentário.
const withComment = (s) => ["//", s, "\nconst a = 1;"].join(" ");
assert.equal(pre("Write", { file_path: "src/a.ts", content: withComment("Bloqueia segredo no código (SEC-002).") }), ""); // ID de regra não é ticket
assert.equal(specific(pre("Write", { file_path: "src/a.ts", content: withComment("Ver DOC-099 antes de mudar.") })).permissionDecision, "deny");
assert.equal(pre("Glob", { pattern: "**/*.ts" }), "");

// ---- Edit só avalia linhas novas: legado preservado (DOC-012) ----
assert.equal(
  pre("Edit", { file_path: "src/a.ts", old_string: "// Corrige issue #1\nconst a = 1;", new_string: "// Corrige issue #1\nconst a = 2;" }),
  "",
);

// ---- .ds-mcp.json: disable exige motivo (PREC-003) ----
const off = mkdtempSync(join(tmpdir(), "ds-hook-off-"));
writeFileSync(join(off, ".ds-mcp.json"), JSON.stringify({ disable: [{ rule: "DOC-004", reason: "Convenção do time usa TODO(ticket)" }] }));
let s;
const BAD = { file_path: "src/a.ts", content: "// Corrige issue #481\nconst a = 1;" };
assert.equal(pre("Write", BAD, off), ""); // exceção válida: desligada

const noReason = mkdtempSync(join(tmpdir(), "ds-hook-noreason-"));
writeFileSync(join(noReason, ".ds-mcp.json"), JSON.stringify({ disable: ["DOC-004", { rule: "DOC-004" }, { rule: "DOC-004", reason: "curto" }] }));
assert.equal(specific(pre("Write", BAD, noReason)).permissionDecision, "deny"); // sem motivo: regra continua ativa

// ---- .ds-mcp.json: ticketKeyIgnore solta o código do domínio, não a regra ----
const codes = mkdtempSync(join(tmpdir(), "ds-hook-codes-"));
writeFileSync(join(codes, ".ds-mcp.json"), JSON.stringify({ ticketKeyIgnore: ["CST", "cst"] }));
const CST = { file_path: "src/a.ts", content: "/** Usa o CST-00 na saída. */\nconst a = 1;" };
assert.equal(specific(pre("Write", CST)).permissionDecision, "deny"); // sem a lista, parece ticket
assert.equal(pre("Write", CST, codes), "");
assert.equal(specific(pre("Write", BAD, codes)).permissionDecision, "deny"); // issue continua bloqueada
s = run("session-start", { cwd: codes });
assert.match(s, /ticketKeyIgnore\): CST/);
assert.match(s, /"cst": IGNORADO/);

// ---- .ds-mcp.json: decisionIdPrefixes liga o alerta de ID de decisão solto ----
const ids = mkdtempSync(join(tmpdir(), "ds-hook-ids-"));
writeFileSync(join(ids, ".ds-mcp.json"), JSON.stringify({ decisionIdPrefixes: ["M", "D", "m"] }));
const LOOSE = { file_path: "src/a.ts", content: "// O cancelamento só vale até 24h (M8 e M9).\nconst a = 1;" };
assert.equal(pre("Write", LOOSE), ""); // sem a lista, desligado
o = specific(pre("Write", LOOSE, ids));
assert.equal(o.permissionDecision, undefined); // alerta, não bloqueia
assert.match(o.additionalContext, /DOC-013/);
s = run("session-start", { cwd: ids });
assert.match(s, /decisionIdPrefixes\): M, D/);
assert.match(s, /"m": IGNORADO/);

// ---- PREC-003: o agente não edita a própria exceção nem desliga hooks ----
assert.equal(specific(pre("Write", { file_path: ".ds-mcp.json", content: '{"disable":[]}' })).permissionDecision, "ask");
assert.equal(specific(pre("Edit", { file_path: join(proj, ".ds-mcp.json"), old_string: "[]", new_string: "[1]" })).permissionDecision, "ask");
assert.equal(specific(pre("Bash", { command: "sed -i 's/a/b/' .ds-mcp.json" })).permissionDecision, "ask");
assert.equal(specific(pre("Write", { file_path: ".claude/settings.json", content: '{"disableAllHooks": true}' })).permissionDecision, "ask");
assert.equal(pre("Bash", { command: "cat .ds-mcp.json" }), ""); // leitura é livre
assert.equal(pre("Read", { file_path: ".ds-mcp.json" }), "");

// ---- robustez: stdin inválido / evento desconhecido não quebram ----
assert.equal(run("pre-tool-use", null, "isto não é json"), "");
assert.equal(run("evento-inexistente", {}), "");
assert.equal(run("pre-tool-use", {}), "");

// ---- SessionStart: texto simples, com as stacks do projeto ----
s = run("session-start", { hook_event_name: "SessionStart", cwd: proj, source: "startup" });
assert.match(s, /react, nestjs/);
assert.match(s, /get_guardrails/);
assert.ok(s.length < 2500, "o lembrete deve ser curto");
assert.match(run("session-start", { cwd: off }), /\.ds-mcp\.json/);

// ---- Stop: gate sobre o diff ----
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const repo = mkdtempSync(join(tmpdir(), "ds-hook-git-"));
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
mkdirSync(join(repo, "src"));
writeFileSync(join(repo, "src", "a.ts"), "// Calcula o total.\nexport const a = 1;\n");
git("add", "-A");
git("commit", "-q", "-m", "init");
const RUN = Date.now(); // o estado anti-loop persiste em tmpdir: sessões únicas por execução
const stop = (sid = "s1") => run("stop", { hook_event_name: "Stop", cwd: repo, session_id: `${sid}-${RUN}` });

assert.equal(stop("clean"), ""); // sem mudanças
writeFileSync(join(repo, "src", "a.ts"), "// Calcula o total.\n// Implementado conforme issue #77\nexport const a = 2;\n");
let b = json(stop("dirty"));
assert.equal(b.decision, "block"); // decision/reason no nível raiz (formato documentado)
assert.match(b.reason, /DOC-004/);
assert.match(b.reason, /a\.ts:2/);
assert.match(json(stop("dirty")).reason, /DOC-004/); // 2º bloqueio
assert.equal(stop("dirty"), ""); // 3º: anti-loop libera
writeFileSync(join(repo, "src", "a.ts"), "// Calcula o total.\nexport const a = 2;\n");
assert.equal(stop("fixed"), ""); // corrigido: passa

writeFileSync(join(repo, ".env"), "API_KEY=abc\n"); // .env não ignorado pelo git
b = json(stop("env"));
assert.match(b.reason, /SEC-003/);
writeFileSync(join(repo, ".gitignore"), ".env\n");
assert.equal(stop("env2"), ""); // ignorado: ok

// ---- violação COMMITADA durante a sessão (skills como implement commitam sozinhas) ----
const startSession = (sid) => run("session-start", { hook_event_name: "SessionStart", cwd: repo, session_id: `${sid}-${RUN}`, source: "startup" });
startSession("commit"); // grava o HEAD inicial da sessão
writeFileSync(join(repo, "src", "b.ts"), "// Ajuste conforme issue #123\nexport const b = 1;\n");
git("add", "-A");
git("commit", "-q", "-m", "feat: b");
assert.equal(stop("sem-base"), ""); // sem base registrada o gate só vê o working tree: não vê o commit
startSession("commit"); // retomada/compactação não pode sobrescrever a base original
b = json(stop("commit"));
assert.match(b.reason, /DOC-004/);
assert.match(b.reason, /b\.ts:1/);

for (const d of [proj, off, noReason, codes, repo]) rmSync(d, { recursive: true, force: true });
console.log(`hooks: ${n} execuções ok`);
