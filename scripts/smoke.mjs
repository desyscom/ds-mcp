import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
const call = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text;

const tools = (await client.listTools()).tools.map((t) => t.name);
assert.deepEqual(tools.sort(), ["check_language", "check_project", "check_references", "get_guardrails", "get_standard", "list_standards"]);
console.log("tools:", tools.join(", "));

// ---- guardrails por stack e fase ----
const plan = await call("get_guardrails", { stacks: ["react"], phase: "plan" });
assert.match(plan, /GEN-005/); // all/architecture
assert.match(plan, /LANG-002/); // idioma vale também ao planejar
assert.match(plan, /Glossário/); // glossário sempre vem junto
assert.doesNotMatch(plan, /REACT-002/); // react só em implement/review
assert.doesNotMatch(plan, /`DOC-001`/); // regras de documentação só em implement/review
const impl = await call("get_guardrails", { stacks: ["react"], phase: "implement" });
assert.match(impl, /REACT-002/);
assert.match(impl, /DOC-004/);
assert.doesNotMatch(impl, /NODE-002/); // nestjs não carregado
const vocab = await call("get_standard", { id: "all/vocabulary" });
assert.match(vocab, /smoke test/);
console.log("get_guardrails / get_standard: ok");

// ---- check_references ----
const out = await call("check_references", { path: "scripts/fixtures/sample.ts" });
console.log("\n" + out + "\n");
const has = (re) => assert.match(out, re);
has(/DOC-004\s+.*sample\.ts:1 /); // issue #1847
has(/DOC-004\s+.*sample\.ts:2 /); // discussão no Slack
has(/DOC-005\s+.*sample\.ts:3 /); // ADR em @Injectable
has(/DOC-004\s+.*sample\.ts:5 /); // TODO com ticket
has(/SCOPE-001\s+.*sample\.ts:6 /); // TODO simples
has(/DOC-010\s+.*sample\.ts:10 /); // URL
has(/DOC-004\s+.*sample\.ts:14 /); // nome de teste com PR
assert.doesNotMatch(out, /sample\.ts:7 /); // comentário bom
assert.doesNotMatch(out, /sample\.ts:9 /); // "#fff" em string
assert.doesNotMatch(out, /sample\.ts:15 /); // UTF-8 / SHA-256
has(/DOC-003\s+.*sample\.ts:16 /); // RFC: alerta, não erro
has(/DOC-006/); // 3+ refs no mesmo arquivo

const refDiff = [
  "diff --git a/x.ts b/x.ts",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -10,2 +10,3 @@",
  " const a = 1;",
  "+// Implementado conforme issue #99",
  " const b = 2;",
].join("\n");
assert.match(await call("check_references", { diff: refDiff }), /DOC-004\s+x\.ts:11 /);
console.log("check_references: ok");

// ---- check_language ----
const lang = await call("check_language", { path: "scripts/fixtures/lang.ts" });
console.log("\n" + lang + "\n");
assert.match(lang, /LANG-002\s+.*lang\.ts:1 /); // teste de fumaça
assert.match(lang, /LANG-001\s+.*lang\.ts:2 /); // comentário em inglês
assert.doesNotMatch(lang, /lang\.ts:3 /); // pt-BR correto com jargão
assert.match(lang, /LANG-002\s+.*lang\.ts:4 /); // carga útil
assert.doesNotMatch(lang, /lang\.ts:5 /); // `canalização` em code span é citação

const proj = await call("check_language", { path: "scripts/fixtures/proj" });
console.log(proj + "\n");
assert.match(proj, /glossário do projeto: .*GLOSSARY\.md.*glossary\.md/i); // as duas fontes, domínio e projeto
assert.match(proj, /LANG-002\s+src[\\/]a\.ts:1 .*fatura/); // avoid definido pelo projeto
assert.match(proj, /LANG-002\s+src[\\/]a\.ts:2 .*publicação/); // projeto adiciona avoid a termo do base
assert.doesNotMatch(proj, /a\.ts:3 /);
assert.match(proj, /LANG-002\s+src[\\/]a\.ts:4 .*cupom.*Nota fiscal/); // `_Avoid_` do GLOSSARY.md de domínio
assert.doesNotMatch(proj, /LANG-002\s+GLOSSARY\.md/); // o próprio glossário não é escaneado
assert.match(proj, /LANG-002\s+README\.md:4 .*mesclagem/);
assert.doesNotMatch(proj, /README\.md:(3|7) /); // smoke test ok; bloco de código ignorado

const langDiff = ["+++ b/src/x.ts", "@@ -1,0 +1,1 @@", "+// Faz a canalização do build."].join("\n");
assert.match(await call("check_language", { root: "scripts/fixtures/proj", diff: langDiff }), /LANG-002\s+src\/x\.ts:1 /);
console.log("check_language: ok");

console.log("\n[check_project .]\n" + (await call("check_project", { path: ".", stacks: ["web", "devops"] })));
await client.close();
