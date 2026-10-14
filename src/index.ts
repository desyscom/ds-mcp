#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";
import { forStacks, loadCatalog, loadRuleIds, standardsDir, type Doc } from "./catalog.js";
import { checkProject } from "./checks.js";
import { collectChanges, commitsSince } from "./gitdiff.js";
import { loadProjectConfig, scanOptions } from "./hooks/config.js";
import { evaluateCommitMessage } from "./hooks/policy.js";
import { checkLanguage } from "./language.js";
import { checkReferences, checkReferencesFiles, formatFindings } from "./references.js";

const server = new McpServer({ name: "ds-mcp", version: "0.2.0" });

// Recarrega a cada chamada: editar um .md reflete sem reiniciar o servidor.
const catalog = () => loadCatalog();
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const render = (d: Doc) => `# ${d.title}  \`${d.id}\` (${d.kind})\n\n${d.body}`;
const phaseArg = z.enum(["plan", "implement", "review"]);
const join = (docs: Doc[]) => docs.map(render).join("\n\n---\n\n");
const stacksArg = z.array(z.string()).describe('Ex.: ["web","devops"]. "all" é sempre incluído.');

// ---------- TOOLS ----------
server.registerTool(
  "list_standards",
  {
    description: "Lista padrões, guardrails e playbooks disponíveis (id, tipo, stack, resumo).",
    inputSchema: { stack: z.string().optional(), kind: z.enum(["standard", "guardrail", "playbook", "glossary"]).optional() },
  },
  async ({ stack, kind }) => {
    const docs = catalog().filter((d) => (!stack || d.stack === stack) && (!kind || d.kind === kind));
    return text(docs.map((d) => `- ${d.id} [${d.kind}/${d.stack}] ${d.title} — ${d.summary}`).join("\n") || "Nenhum resultado.");
  },
);

server.registerTool(
  "get_standard",
  { description: "Retorna o conteúdo completo de um padrão/guardrail pelo id.", inputSchema: { id: z.string() } },
  async ({ id }) => {
    const d = catalog().find((x) => x.id === id);
    return d ? text(render(d)) : { ...text(`Id "${id}" não encontrado. Use list_standards.`), isError: true };
  },
);

server.registerTool(
  "get_guardrails",
  {
    description:
      "Retorna as regras inegociáveis (guardrails) e o glossário para as stacks informadas. Chame ANTES de escrever código. " +
      "Use `phase` para carregar só o relevante: plan (decidir), implement (escrever), review (revisar).",
    inputSchema: { stacks: stacksArg, phase: phaseArg.optional() },
  },
  async ({ stacks, phase }) =>
    text(
      join(forStacks(catalog(), stacks, phase).filter((d) => d.kind === "guardrail" || d.kind === "glossary")) ||
        "Sem guardrails.",
    ),
);

// Fonte das linhas a escanear: exatamente uma entre path, diff e repo.
const sourceArgs = {
  path: z.string().optional().describe("Arquivo ou diretório (auditoria do que já existe)"),
  diff: z.string().optional().describe("Saída de `git diff` (unified); só as linhas adicionadas contam"),
  repo: z.string().optional().describe("Repositório git: avalia as mudanças desde `base` (commits + working tree + arquivos novos). Sem colar diff"),
  base: z.string().optional().describe("Com `repo`: ref de comparação (default HEAD; ex.: main, origin/main, HEAD~3)"),
  limit: z.number().int().positive().optional().describe("Máximo de achados listados (default 200); o resumo por regra é sempre completo"),
};
const oneSource = ({ path, diff, repo }: { path?: string; diff?: string; repo?: string }) => [path, diff, repo].filter(Boolean).length === 1;
const ONE = "Informe exatamente um entre `path`, `diff` e `repo`.";

server.registerTool(
  "check_references",
  {
    description:
      "Escaneia comentários e nomes de teste atrás de referências indevidas (issue, PR, ticket, conversa, URL, TODO com ref) " +
      "e referências a ADR/spec que exigem justificativa (DOC-003..006, DOC-010, SCOPE-001). " +
      "Com `decisionIdPrefixes` no `.ds-mcp.json`, alerta ID de decisão sem o ADR (DOC-013). Informe `path` (auditoria), `diff` OU `repo` (+`base`) para revisar mudanças.",
    inputSchema: sourceArgs,
  },
  async (args) => {
    if (!oneSource(args)) return { ...text(ONE), isError: true };
    const { path, diff, repo, base, limit } = args;
    // `diff` não diz de que projeto veio: só path e repo acham o `.ds-mcp.json`. Os IDs de regra valem para todos.
    const from = repo ?? path;
    const scan = from ? scanOptions(loadProjectConfig(resolve(from))) : { ruleIds: loadRuleIds() };
    if (repo) {
      const changes = collectChanges(resolve(repo), base);
      if (!changes) return { ...text(`"${repo}" não é um repositório git.`), isError: true };
      return text(formatFindings(checkReferencesFiles(changes.added, scan), { limit }));
    }
    return text(formatFindings(checkReferences({ path: path ? resolve(path) : undefined, diff }, scan), { limit }));
  },
);

server.registerTool(
  "check_language",
  {
    description:
      "Escaneia comentários, nomes de teste e .md atrás de tradução literal de vocabulário técnico (LANG-002) e texto em inglês (LANG-001). " +
      "Usa o vocabulário-base, o GLOSSARY.md de domínio (_Avoid_) e o docs/glossary.md do projeto. Informe `path` (auditoria), `diff` OU `repo` (+`base`).",
    inputSchema: { ...sourceArgs, root: z.string().optional().describe("Raiz do projeto, para achar os glossários (necessário só com `diff`)") },
  },
  async (args) => {
    if (!oneSource(args)) return { ...text(ONE), isError: true };
    const { path, diff, repo, base, root, limit } = args;
    if (repo && !collectChanges(resolve(repo), base)) return { ...text(`"${repo}" não é um repositório git.`), isError: true };
    const { findings, projectGlossary } = checkLanguage({ path, diff, root, repo, base });
    const head = `glossários: ${projectGlossary ?? "nenhum (usando só o vocabulário-base)"}

`;
    return text(head + formatFindings(findings, { limit, empty: "Nenhum problema de idioma encontrado." }));
  },
);

server.registerTool(
  "check_commits",
  {
    description:
      "Avalia as mensagens dos commits em `base..HEAD` contra COMMIT-001..003 (Conventional Commits, pt-BR, 72 caracteres) e o idioma (LANG-001/002).",
    inputSchema: {
      repo: z.string().describe("Repositório git"),
      base: z.string().optional().describe("Ref de comparação (default HEAD~1); avalia os commits de base..HEAD"),
    },
  },
  async ({ repo, base }) => {
    const commits = commitsSince(resolve(repo), base ?? "HEAD~1");
    if (!commits) return { ...text(`Não foi possível listar commits de "${base ?? "HEAD~1"}..HEAD" em "${repo}" (não é um repositório git, ou a base não existe).`), isError: true };
    if (!commits.length) return text("Nenhum commit na faixa.");
    const rows = commits.flatMap((c) => {
      const vs = evaluateCommitMessage(c.message, resolve(repo));
      const subject = c.message.split(/\r?\n/)[0];
      return vs.length ? [`${c.sha.slice(0, 7)} "${subject}"`, ...vs.map((x) => `  ${x.level === "deny" ? "ERRO " : "ALERTA"} ${x.rule}  ${x.message}`)] : [];
    });
    const bad = commits.filter((c) => evaluateCommitMessage(c.message, resolve(repo)).length).length;
    return text(`${commits.length} commit(s) avaliados, ${bad} com problemas.${rows.length ? `\n\n${rows.join("\n")}` : ""}`);
  },
);

server.registerTool(
  "check_project",
  {
    description: "Audita um diretório de projeto contra regras verificáveis automaticamente (somente leitura).",
    inputSchema: { path: z.string().describe("Caminho do projeto"), stacks: stacksArg },
  },
  async ({ path, stacks }) => {
    const results = checkProject(resolve(path), stacks);
    const failed = results.filter((r) => !r.ok);
    const lines = results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.message}  → ${r.rule}`);
    return text(`${results.length - failed.length}/${results.length} checks ok\n\n${lines.join("\n")}`);
  },
);

// ---------- RESOURCES ----------
server.registerResource(
  "standard",
  new ResourceTemplate("standards://{+id}", {
    list: async () => ({
      resources: catalog().map((d) => ({ uri: `standards://${d.id}`, name: d.title, description: d.summary, mimeType: "text/markdown" })),
    }),
  }),
  { description: "Documentos de padrões, guardrails e playbooks", mimeType: "text/markdown" },
  async (uri, { id }) => {
    const d = catalog().find((x) => x.id === id);
    if (!d) throw new Error(`Padrão não encontrado: ${id}`);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: render(d) }] };
  },
);

// ---------- PROMPTS ----------
server.registerPrompt(
  "start_task",
  {
    description: "Inicia uma tarefa carregando guardrails + padrões das stacks.",
    argsSchema: {
      task: z.string(),
      stacks: z.string().describe('Separadas por vírgula, ex.: "react,web"'),
      phase: phaseArg.optional().describe("Default: implement"),
    },
  },
  ({ task, stacks, phase }) => {
    const docs = forStacks(catalog(), stacks.split(",").map((s) => s.trim()).filter(Boolean), phase ?? "implement");
    const body = join(docs);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Tarefa: ${task}\n\nSiga estritamente os guardrails e padrões abaixo. Se algo conflitar, pare e pergunte.\n\n${body}`,
          },
        },
      ],
    };
  },
);

server.registerPrompt(
  "review_against_standards",
  { description: "Revisa código/diff contra os padrões das stacks.", argsSchema: { stacks: z.string() } },
  ({ stacks }) => {
    const docs = forStacks(catalog(), stacks.split(",").map((s) => s.trim()).filter(Boolean), "review");
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Revise as mudanças atuais contra os padrões abaixo. Liste violações com id da regra, arquivo:linha e correção sugerida.\n\n${join(docs)}`,
          },
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
console.error(`ds-mcp pronto. standards: ${standardsDir}`); // stderr: stdout é o protocolo
