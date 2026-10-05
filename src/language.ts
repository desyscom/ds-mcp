import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { standardsDir } from "./catalog.js";
import { commentText, HASH_EXT, MAX_FILE_BYTES, parseDiff, SLASH_EXT, testTitle, walk, type Finding } from "./references.js";

interface Entry {
  term: string;
  preferred: string;
  avoid: string[];
}

/** Lê tabelas `| Termo | Preferido | Evitar | ... |` de um Markdown. */
export function parseVocabulary(md: string): Entry[] {
  const out: Entry[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 3 || /^:?-+:?$/.test(cells[0]) || /^(termo|term)$/i.test(cells[0])) continue;
    const avoid = cells[2]
      .split(/[,;]/)
      .map((a) => a.trim().replace(/^`|`$/g, ""))
      .filter((a) => a && a !== "—" && a !== "-");
    out.push({ term: cells[0].toLowerCase(), preferred: cells[1], avoid });
  }
  return out;
}

/** Procura docs/glossary.md subindo a partir de `start` (até 6 níveis). */
function findProjectGlossary(start: string): string | null {
  let dir = statSync(start).isFile() ? dirname(start) : start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "docs", "glossary.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Vocabulário-base + glossário do projeto (o do projeto sobrescreve por termo). */
export function loadVocabulary(projectStart?: string): { entries: Entry[]; projectGlossary: string | null } {
  const merged = new Map<string, Entry>();
  const base = join(standardsDir, "all", "vocabulary.md");
  if (existsSync(base)) for (const e of parseVocabulary(readFileSync(base, "utf8"))) merged.set(e.term, e);
  const projectGlossary = projectStart && existsSync(projectStart) ? findProjectGlossary(projectStart) : null;
  if (projectGlossary) for (const e of parseVocabulary(readFileSync(projectGlossary, "utf8"))) merged.set(e.term, e);
  return { entries: [...merged.values()], projectGlossary };
}

const EN = new Set("the is are and to of for this that with from in on it be by or not when if will can should must we you your our which has have was were an at into than then so also but".split(" "));
const PT = new Set("o os de do da dos das que para por com não uma um é em no na nos nas se ao à como mais mas ou sem sobre entre quando já também ser são foi está estão pelo pela deve".split(" "));

const stripCode = (s: string) => s.replace(/`[^`]*`/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

function looksEnglish(text: string): boolean {
  const words = stripCode(text).toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 6) return false;
  const en = words.filter((w) => EN.has(w)).length;
  const pt = words.filter((w) => PT.has(w)).length;
  return en >= 2 && en > pt;
}

function scanLines(file: string, lines: { n: number; text: string }[], ext: string, avoid: { re: RegExp; entry: Entry; word: string }[]): Finding[] {
  const out: Finding[] = [];
  const isMd = ext === ".md";
  let inFence = false;
  for (const { n, text } of lines) {
    let prose: string | null = null;
    if (isMd) {
      if (/^\s*(```|~~~)/.test(text)) { inFence = !inFence; continue; }
      if (!inFence && !/^\s*\|?\s*:?-{3,}/.test(text)) prose = text;
    } else {
      prose = commentText(text, ext) ?? testTitle(text);
    }
    if (prose === null) continue;
    const clean = stripCode(prose);
    const snippet = text.trim().slice(0, 140);
    if (looksEnglish(clean)) out.push({ file, line: n, rule: "LANG-001", severity: "warn", message: "texto parece estar em inglês — documentação e comentários são pt-BR", snippet });
    // um alerta por termo e linha, usando a variante mais longa ("teste de fumaça" e não "fumaça")
    const hits = new Map<Entry, string>();
    for (const { re, entry, word } of avoid)
      if (re.test(clean) && word.length > (hits.get(entry)?.length ?? 0)) hits.set(entry, word);
    for (const [entry, word] of hits)
      out.push({ file, line: n, rule: "LANG-002", severity: "warn", message: `"${word}" → use "${entry.preferred}" (termo: ${entry.term})`, snippet });
  }
  return out;
}

/** Scanner reutilizável: vocabulário carregado uma vez, aplicável a qualquer conjunto de linhas. */
export function createLanguageScanner(projectStart?: string) {
  const { entries, projectGlossary } = loadVocabulary(projectStart ? resolve(projectStart) : undefined);
  const avoid = entries.flatMap((entry) =>
    entry.avoid.map((word) => ({ entry, word, re: new RegExp(`(?<![\\p{L}\\p{N}_-])${esc(word)}(?![\\p{L}\\p{N}_-])`, "iu") })),
  );
  const isGlossary = (f: string) => /^(glossary|vocabulary)\.md$/i.test(basename(f));
  const supported = (f: string) => {
    const ext = extname(f);
    return (SLASH_EXT.has(ext) || HASH_EXT.has(ext) || ext === ".md") && !isGlossary(f);
  };
  return {
    projectGlossary,
    supported,
    scan: (file: string, lines: { n: number; text: string }[]): Finding[] =>
      supported(file) ? scanLines(file, lines, extname(file), avoid) : [],
  };
}

export function checkLanguage(input: { path?: string; diff?: string; root?: string }): { findings: Finding[]; projectGlossary: string | null } {
  const scanner = createLanguageScanner(input.root ?? input.path);
  const findings: Finding[] = [];

  if (input.diff) {
    for (const [f, lines] of parseDiff(input.diff)) findings.push(...scanner.scan(f, lines));
  } else if (input.path) {
    const root = resolve(input.path);
    const isFile = statSync(root).isFile();
    for (const file of walk(root)) {
      if (!scanner.supported(file) || statSync(file).size > MAX_FILE_BYTES) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
      findings.push(...scanner.scan(isFile ? file : relative(root, file), lines));
    }
  }
  return { findings, projectGlossary: scanner.projectGlossary };
}
