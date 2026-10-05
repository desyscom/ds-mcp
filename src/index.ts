#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";
import { forStacks, loadCatalog, standardsDir, type Doc } from "./catalog.js";
import { checkProject } from "./checks.js";
import { checkLanguage } from "./language.js";
import { checkReferences, formatFindings } from "./references.js";

const server = new McpServer({ name: "ds-mcp", version: "0.1.0" });

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

server.registerTool(
  "check_references",
  {
    description:
      "Escaneia comentários e nomes de teste atrás de referências indevidas (issue, PR, ticket, conversa, URL, TODO com ref) " +
      "e referências a ADR/spec que exigem justificativa (DOC-003..006, DOC-010). Informe `diff` (só linhas adicionadas) OU `path`.",
    inputSchema: {
      path: z.string().optional().describe("Arquivo ou diretório"),
      diff: z.string().optional().describe("Saída de `git diff` (unified)"),
    },
  },
  async ({ path, diff }) => {
    if (!path === !diff) return { ...text("Informe exatamente um entre `path` e `diff`."), isError: true };
    return text(formatFindings(checkReferences({ path: path ? resolve(path) : undefined, diff })));
  },
);

server.registerTool(
  "check_language",
  {
    description:
      "Escaneia comentários, nomes de teste e .md atrás de tradução literal de vocabulário técnico (LANG-002) e texto em inglês (LANG-001). " +
      "Usa o vocabulário-base + docs/glossary.md do projeto (procurado a partir de `root` ou `path`). Informe `diff` OU `path`.",
    inputSchema: {
      path: z.string().optional().describe("Arquivo ou diretório"),
      diff: z.string().optional().describe("Saída de `git diff` (unified)"),
      root: z.string().optional().describe("Raiz do projeto, para achar docs/glossary.md (necessário quando só há `diff`)"),
    },
  },
  async ({ path, diff, root }) => {
    if (!path === !diff) return { ...text("Informe exatamente um entre `path` e `diff`."), isError: true };
    const { findings, projectGlossary } = checkLanguage({ path, diff, root });
    const head = `glossário do projeto: ${projectGlossary ?? "nenhum (usando só o vocabulário-base)"}

`;
    return text(head + (findings.length ? formatFindings(findings) : "Nenhum problema de idioma encontrado."));
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
