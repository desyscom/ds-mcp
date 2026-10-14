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

// ---- número com `#` que não é issue: decisão de ADR, regra de anexo e norma ----
for (const t of [
  "Camada montada uma vez por nota (ADR-002 #5/#7).",
  "Chave tipada que decide o ramo do ICMS (ADR-002 #4 / adendo 3).",
  "Montada por item (ADR-002 #7 / ADR-008 G2).",
  "Espelha a regra da recepção (ANEXO_I RN #30/#32).",
  "O nome do prestador é obrigatório (RN #203).",
  "Identificação estrangeira vedada (RN #244/#247 · #282/#285).",
  "O endereço do prestador quando `tpEmit=1` (#202/#206 do anexo) fica de fora.",
  "A RN de cabeçalho (#154 do anexo) segue advisory.",
  "Abre o PKCS#12 do A1; a chave chega em PKCS#8.",
  "O contêiner é o PKCS #12, com a senha do emitente.",
]) passes(t);
for (const t of [
  "Segue a ADR-24 de plataforma, #1083.", // separado do ADR por vírgula: é a issue
  "Agenda o envio (ADR-23 de plataforma, A7 a A9; #1082).",
  "Vem do ADR-002 / PRD #16.",
  "ADR-12 #872 fixou o limite.", // três dígitos colados ao ADR: é a issue
  "Validação local de RN (#212).",
  "Convive com o #154, ambas advisory.",
]) fires(t);
n++;
assert.deepEqual(rules("TODO: revisar a RN #203"), ["SCOPE-001/warn"], "RN no TODO não é referência a issue");
n++;
assert.ok(rules("Camada montada uma vez por nota (ADR-002 #5/#7).").includes("DOC-005/warn"), "o ADR continua avisado pelo DOC-005");

// ---- referência a ADR: exemplo de formato entre crases não cita; o ID sozinho entre crases cita ----
const citesAdr = (text) => rules(text).includes("DOC-005/warn");
for (const t of [
  "O ADR qualifica qualquer ID da linha, na forma que o projeto usar: `ADR-35 M8`, `D5 do ADR-12`, `ADR plataforma-29, D5`.",
  "Aceita a forma `ADR-0035 M8` na mesma referência.",
]) {
  n++;
  assert.ok(!citesAdr(t), `não deveria alertar referência a ADR: ${t}`);
}
for (const t of ["Não alterar para execução síncrona sem revisar `ADR-0012`.", "Não alterar sem revisar ADR-012.", "Processa fora da requisição (ADR-12); o formato é `X-1 Y`."]) {
  n++;
  assert.ok(citesAdr(t), `deveria alertar referência a ADR: ${t}`);
}

// ---- forma do comentário: JSX, bloco depois de código e continuação de bloco sem `*` ----
// As aberturas são montadas em tempo de execução: escritas literalmente, abririam um bloco neste arquivo.
const JSX = "{/" + "*";
const BLOCO = "/" + "*";
const CODIGO = 'const id = "#12";';
const numbered = (...texts) => texts.map((text, i) => ({ n: i + 1, text }));
const cited = (ext, lines) => scanLines(`a${ext}`, lines, ext).filter((f) => f.rule === "DOC-004").map((f) => f.line);
const expectCited = (label, ext, lines, expected) => {
  n++;
  assert.deepEqual(cited(ext, lines), expected, `${label}: DOC-004 nas linhas ${JSON.stringify(expected)}`);
};
expectCited("JSX no início da linha", ".tsx", numbered(`      ${JSX} rota nova (#549) */}`), [1]);
expectCited("JSX depois de código", ".tsx", numbered(`  <div>${JSX} #45 */}</div>`), [1]);
expectCited("bloco depois de código", ".ts", numbered(`const x = 1; ${BLOCO} ver #88 */`), [1]);
expectCited("continuação de JSX", ".tsx", numbered(
  `      ${JSX} Não é um Campo: a estrutura é a de`,
  "          lá (#642) — o label associado, e a dica fora dele.",
  "          Envolver o input com o label esconderia a dica. */}",
  "      <input />",
), [2]);
expectCited("continuação de bloco", ".ts", numbered(BLOCO, "   decisão 6 do #620: o contrato nunca rebaixa emitente.", "*/"), [2]);
expectCited("continuação de bloco em CSS", ".css", numbered(BLOCO, "   o orçamento de espera da suíte (#701) não cobre a animação.", "*/"), [2]);
expectCited("código depois do fecho", ".ts", numbered(BLOCO, "   texto", "*/", CODIGO), []);
expectCited("código depois do fecho na mesma linha", ".ts", numbered(`${BLOCO} texto`, `fim */ ${CODIGO}`), []);
expectCited("lacuna interrompe o bloco", ".ts", [{ n: 1, text: BLOCO }, { n: 3, text: "   decisão do #620" }], []);
expectCited("glob em string não abre bloco", ".ts", numbered('const g = "src/**/*.ts";', CODIGO), []);
expectCited("barra-asterisco em string não abre bloco", ".ts", numbered(`const p = "${BLOCO}";`, CODIGO), []);
expectCited("barra-asterisco em regex não abre bloco", ".ts", numbered("const re = /a\\/*b/;", CODIGO), []);
expectCited("barra-asterisco dentro de comentário de linha não abre bloco", ".ts", numbered(`/${"/"} o padrão ${BLOCO} fica aqui`, CODIGO), []);

// ---- lexer: o comentário vem da sintaxe, não da posição na linha ----
const LINHA = "/" + "/";
const CRASE = "`";
expectCited("bloco depois de `=`", ".ts", numbered(`const x =${BLOCO} ver #88 */ 1;`), [1]);
expectCited("bloco depois de `[`", ".ts", numbered(`const a = [${BLOCO} ver #88 */];`), [1]);
expectCited("JSX depois da tag de fecho", ".tsx", numbered(`<p>texto</p> ${JSX} ver #45 */}`), [1]);
expectCited("divisão depois de `++` não abre regex", ".ts", numbered(`const m = a++ / 2; ${LINHA} ver #12`), [1]);
expectCited("barras dentro de string", ".ts", numbered(`const u = "abc${LINHA}#12";`), []);
expectCited("barra escapada no fim da regex", ".ts", numbered(`const m = /a\\${LINHA}.exec("#12");`), []);
expectCited("template literal não é comentário", ".ts", numbered(`const cabecalho = ${CRASE}`, ` * gerado; ver #12`, `${LINHA} ver #13`, `${CRASE};`, CODIGO), []);
expectCited("comentário dentro da expressão do template", ".ts", numbered(`const s = ${CRASE}a\${x ${BLOCO} ver #12 */}b${CRASE};`), [1]);
expectCited("trecho que começa dentro de um template", ".ts", [
  { n: 10, text: "  WHERE x = 1" },
  { n: 11, text: `${CRASE};` },
  { n: 12, text: `${LINHA} ver #12` },
], [12]);
expectCited("trecho que termina dentro de um template", ".ts", numbered(`${LINHA} ver #12`, `const q = sql${CRASE}`, "  SELECT 1"), [1]);
expectCited("trecho que começa na continuação de um bloco", ".ts", [{ n: 7, text: " * decisão do #620" }, { n: 8, text: " */" }, { n: 9, text: CODIGO }], [7]);
expectCited("string crua do Go", ".go", numbered(`x := ${CRASE}${LINHA} #12${CRASE}`, `y := 1 ${LINHA} ver #12`), [2]);
expectCited("bloco de texto do Java", ".java", numbered('String s = """', `  ${LINHA} #12`, '""";', `int y = 1; ${LINHA} ver #12`), [4]);
expectCited("string verbatim do C#", ".cs", numbered(`var s = @"a ${LINHA} #12";`), []);
expectCited("lifetime do Rust não abre literal", ".rs", numbered(`fn f<'a>(x: &'a str) {} ${LINHA} ver #12`), [1]);
expectCited("CSS não tem comentário de linha", ".css", numbered(`a { background: url(${LINHA}cdn.x/#12); }`, `${BLOCO} ver #12 */`), [2]);

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
n++;
assert.ok(
  lang.scan("a.tsx", numbered(`${JSX} This component renders the list of the items`, "for the user when the page loads */}")).some((f) => f.rule === "LANG-001" && f.line === 2),
  "texto em inglês na continuação de JSX é avisado",
);

console.log(`references: ${n} casos ok`);
