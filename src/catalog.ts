import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export type Kind = "standard" | "guardrail" | "playbook" | "glossary";
export type Phase = "plan" | "implement" | "review";
const ALL_PHASES: Phase[] = ["plan", "implement", "review"];

export interface Doc {
  id: string;
  title: string;
  kind: Kind;
  stack: string; // "all" | "web" | "devops" | ...
  tags: string[];
  phases: Phase[]; // fases em que o doc é relevante (default: todas)
  summary: string;
  body: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Permite apontar para um repo de padrões do time via DS_MCP_STANDARDS_DIR. */
export const standardsDir = resolve(
  process.env.DS_MCP_STANDARDS_DIR ?? join(here, "..", "standards"),
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".md") ? [full] : [];
  });
}

export function loadCatalog(): Doc[] {
  return walk(standardsDir)
    .map((file) => {
      const { data, content } = matter(readFileSync(file, "utf8"));
      const id = relative(standardsDir, file).split(sep).join("/").replace(/\.md$/, "");
      return {
        id,
        title: String(data.title ?? id),
        kind: (data.kind ?? "standard") as Kind,
        stack: String(data.stack ?? id.split("/")[0]),
        tags: (data.tags ?? []) as string[],
        phases: (data.phases ?? ALL_PHASES) as Phase[],
        summary: String(data.summary ?? ""),
        body: content.trim(),
      } satisfies Doc;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const DECLARED_ID = /^- `([A-Z]{2,10}-\d{3})`/;
const ID = /\b[A-Z]{2,10}-\d{3}\b/g;

/**
 * IDs de regra dos padrões: os declarados (item de lista que abre com o ID entre crases) e os retirados, que ainda
 * nomeiam a regra que os absorveu. Exemplos no corpo do padrão não entram.
 */
export function loadRuleIds(dir = standardsDir): Set<string> {
  const ids = new Set<string>();
  for (const file of walk(dir))
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const declared = DECLARED_ID.exec(line);
      if (declared) ids.add(declared[1]);
      else if (line.startsWith("*IDs retirados:*")) for (const m of line.matchAll(ID)) ids.add(m[0]);
    }
  return ids;
}

/** Docs aplicáveis a um conjunto de stacks ("all" sempre entra), opcionalmente filtrados por fase. */
export function forStacks(docs: Doc[], stacks: string[], phase?: Phase): Doc[] {
  const set = new Set(["all", ...stacks]);
  return docs.filter((d) => set.has(d.stack) && (!phase || d.phases.includes(phase)));
}
