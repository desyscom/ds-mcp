// Casos de falso positivo e de acerto do scanner de referências e do vocabulário-base.
// As linhas avaliadas são strings, não comentários deste arquivo: `c()` as embrulha num comentário TypeScript.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig } from "../build/hooks/config.js";
import { createLanguageScanner } from "../build/language.js";
import { scanLines } from "../build/references.js";

let n = 0;
const c = (s) => `/* ${s} */`;
const rules = (text, opts) => scanLines("a.ts", [{ n: 1, text: c(text) }], ".ts", opts).map((f) => `${f.rule}/${f.severity}`);
const fires = (text, opts) => {
  n++;
  assert.ok(rules(text, opts).includes("DOC-004/error"), `deveria disparar DOC-004: ${text}`);
};
const passes = (text, opts) => {
  n++;
  assert.ok(!rules(text, opts).includes("DOC-004/error"), `não deveria disparar DOC-004: ${text} → ${rules(text, opts)}`);
};

// ---- chave de ticket: o prefixo é só de letras ----
for (const t of [
  "Soma ao `vNF` (W16-10).",
  "Rejeição N12-20 quando o CST não fecha com a CSOSN.",
  "ZX02-10: o QR Code exige a URL de consulta.",
  "I08-150, B22-10, Q01-20, S01-20 e I04-10 valem só para o modelo 65.",
  "B25-120 e B09-60 travam a data de emissão.",
  "UB16-10: o grupo de IBS/CBS exige o CST.",
  "Cifra o segredo com AES-256-GCM.",
  "Assina com RSA-2048 e SHA-256; o texto é UTF-8 (ISO-8859-1 é recusado).",
  "Aceita só `[A-Z0-9]{12}`.",
  "Competência normalizada ao 1º dia do mês (`YYYY-MM-01`).",
]) passes(t);
for (const t of [
  "Corrige PROJ-42",
  "Ver JIRA-123 antes de mudar",
  "Corrige issue #123",
  "TODO(JIRA-12): ajustar",
  "Regressão de AB-7",
]) fires(t);

// ---- ticketKeyIgnore: códigos do domínio que o projeto declara ----
fires("Usa o CST-00 na saída.");
passes("Usa o CST-00 na saída.", { ticketKeyIgnore: ["CST"] });
fires("Corrige PROJ-42", { ticketKeyIgnore: ["CST"] });

const proj = mkdtempSync(join(tmpdir(), "ds-refs-"));
writeFileSync(join(proj, ".ds-mcp.json"), JSON.stringify({ ticketKeyIgnore: ["CST", "CSOSN", "cst", "N12", "X", 5, "ABCDEFGHIJK"] }));
const cfg = loadProjectConfig(proj);
n++;
assert.deepEqual(cfg.ticketKeyIgnore, ["CST", "CSOSN"]);
assert.deepEqual(cfg.invalidTicketKeyIgnore, ["cst", "N12", "X", "5", "ABCDEFGHIJK"]);
rmSync(proj, { recursive: true, force: true });

// ---- conversa: ordinal e palavras comuns do código não são citação ----
for (const t of [
  "reset malicioso ou por engenharia social derruba o segundo fator em silêncio, e este e-mail é",
  "atravessável por duas passadas simultâneas — e quando a segunda descobrisse, o segundo e-mail já teria",
  "impede o segundo e-mail é a linha de `avisos_termos`, e é essa distinção que o caso trava.",
  "o login por senha não alcança as chaves do segundo fator: a `conta` sem forma de e-mail é recusada",
  "Envia o e-mail de recuperação conforme o template do tenant.",
  "Veja o call site antes de mudar a assinatura.",
]) passes(t);
for (const t of [
  "Conforme discutido na reunião, o estoque não é consultado.",
  "Ver thread no Slack",
  "Conforme ADR-023 e a discussão no Slack, não consultamos o estoque.",
  "Segundo a reunião de ontem, o desconto fica fora.",
  "Conforme combinado por e-mail com o cliente.",
  "Alinhado na call de ontem.",
]) fires(t);

// ---- vocabulário: "ramo", "árvore" e "acessório" são português legítimo ----
const lang = createLanguageScanner(process.cwd());
const avoided = (text) => lang.scan("a.ts", [{ n: 1, text: c(text) }]).filter((f) => f.rule === "LANG-002");
for (const t of [
  "O ramo `gIBSCBSMono` do choice só existe na tributação monofásica.",
  "Percorre a árvore de sintaxe antes de emitir.",
  "O evento acessório não altera o valor da nota.",
]) {
  n++;
  assert.deepEqual(avoided(t), [], `não deveria avisar tradução literal: ${t}`);
}
n++;
assert.equal(avoided("Roda o teste de fumaça antes do deploy.").length, 1); // tradução literal continua avisada

console.log(`references: ${n} casos ok`);
