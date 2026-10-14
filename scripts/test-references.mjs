// Casos de falso positivo e de acerto do scanner de referências e do vocabulário-base.
// As linhas avaliadas são strings, não comentários deste arquivo: `c()` as embrulha num comentário TypeScript.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuleIds } from "../build/catalog.js";
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

// ---- ID de regra dos padrões: nomeia um guardrail, não um ticket ----
const ids = loadRuleIds();
n++;
assert.ok(ids.has("DOC-013") && ids.has("SEC-002"), "IDs declarados entram");
assert.ok(ids.has("DOC-009") && ids.has("REACT-008"), "IDs retirados entram");
assert.ok(!ids.has("ADR-012") && !ids.has("DOC-099"), "exemplo e ID inexistente ficam de fora");
const R = { ruleIds: ids };
passes("Bloqueia segredo no código (SEC-002).", R);
passes("O ID retirado DOC-009 virou parte do DOC-002.", R);
fires("Bloqueia segredo no código (SEC-002)."); // sem a lista, o scanner não sabe que é regra
fires("Ver DOC-099 antes de mudar.", R);
fires("SEC-002 e PROJ-42 tratam do mesmo segredo.", R);
fires("Regressão de TEST-12.", R);

const proj = mkdtempSync(join(tmpdir(), "ds-refs-"));
writeFileSync(join(proj, ".ds-mcp.json"), JSON.stringify({ ticketKeyIgnore: ["CST", "CSOSN", "cst", "N12", "X", 5, "ABCDEFGHIJK"] }));
const cfg = loadProjectConfig(proj);
n++;
assert.deepEqual(cfg.ticketKeyIgnore, ["CST", "CSOSN"]);
assert.deepEqual(cfg.invalidTicketKeyIgnore, ["cst", "N12", "X", "5", "ABCDEFGHIJK"]);
rmSync(proj, { recursive: true, force: true });

// ---- ID de decisão solto: só com decisionIdPrefixes, e o ADR na mesma linha qualifica ----
const D = { decisionIdPrefixes: ["M", "D", "P"] };
const loose = (text, opts) => rules(text, opts).includes("DOC-013/warn");
for (const t of [
  "Emite o grupo M01 do leiaute antes dos totais.",
  "Grava o XML no S3 antes de responder.",
  "A emissão não espera a autorização (ADR-35 M8).",
  "D5 do ADR-12: o lote fecha às 18h.",
  "Segue o ADR plataforma-29, D5: o certificado fica no cofre.",
  "Calcula o MD5 do arquivo e o P2P fica fora.",
]) {
  n++;
  assert.ok(!loose(t, D), `não deveria alertar ID de decisão: ${t} → ${rules(t, D)}`);
}
for (const t of ["O cancelamento só vale até 24h (M8 e M9).", "P3: o desconto não acumula com a promoção."]) {
  n++;
  assert.ok(loose(t, D), `deveria alertar ID de decisão: ${t}`);
}
n++;
assert.ok(!loose("O cancelamento só vale até 24h (M8 e M9)."), "sem decisionIdPrefixes, o alerta fica desligado");

const idsProj = mkdtempSync(join(tmpdir(), "ds-refs-ids-"));
writeFileSync(join(idsProj, ".ds-mcp.json"), JSON.stringify({ decisionIdPrefixes: ["M", "DE", "m", "M1", "ABCD", 5] }));
const idsCfg = loadProjectConfig(idsProj);
n++;
assert.deepEqual(idsCfg.decisionIdPrefixes, ["M", "DE"]);
assert.deepEqual(idsCfg.invalidDecisionIdPrefixes, ["m", "M1", "ABCD", "5"]);
rmSync(idsProj, { recursive: true, force: true });

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
