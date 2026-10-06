import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDiff } from "./references.js";

export const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

export interface Line {
  n: number;
  text: string;
}

export interface Changes {
  /** raiz do repositório (caminhos abaixo são relativos a ela) */
  gitRoot: string;
  /** arquivo (relativo à raiz do git) → linhas adicionadas desde `base`, inclusive arquivos novos não rastreados */
  added: Map<string, Line[]>;
  /** todos os arquivos modificados desde `base` + não rastreados (para checagens por nome de arquivo) */
  files: string[];
}

const SAFE_REF = /^[\w][\w./~^@{}-]*$/; // nunca começa com "-": impede injeção de opção no git
const MAX_FILE = 256 * 1024;
const MAX_UNTRACKED = 200;

/**
 * Linhas adicionadas desde `base` (commits + working tree) e arquivos novos.
 * Retorna null se `cwd` não for um repositório git.
 */
export function collectChanges(cwd: string, base = "HEAD"): Changes | null {
  if (!SAFE_REF.test(base)) throw new Error(`ref git inválida: ${base}`);
  let gitRoot: string;
  try {
    gitRoot = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }

  let diff = "";
  let changed: string[] = [];
  try {
    diff = git(gitRoot, ["diff", base, "--unified=0", "--"]);
    changed = git(gitRoot, ["diff", base, "--name-only", "--"]).split(/\r?\n/).filter(Boolean);
  } catch {
    // sem commits ou base inexistente: cai para o working tree
    try { diff = git(gitRoot, ["diff", "--unified=0", "--"]); changed = git(gitRoot, ["diff", "--name-only", "--"]).split(/\r?\n/).filter(Boolean); } catch { /* sem diff */ }
  }
  const untracked = git(gitRoot, ["ls-files", "--others", "--exclude-standard", "--full-name"]).split(/\r?\n/).filter(Boolean);

  const added = parseDiff(diff);
  for (const file of untracked.slice(0, MAX_UNTRACKED)) {
    const abs = join(gitRoot, file);
    if (!existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > MAX_FILE) continue;
    added.set(file, readFileSync(abs, "utf8").split(/\r?\n/).map((text, i) => ({ n: i + 1, text })));
  }
  return { gitRoot, added, files: [...new Set([...changed, ...untracked])] };
}

export interface CommitInfo {
  sha: string;
  message: string;
}

/** Commits em `base..HEAD` (mais recentes primeiro). Retorna null se `cwd` não for um repositório git. */
export function commitsSince(cwd: string, base: string): CommitInfo[] | null {
  if (!SAFE_REF.test(base)) throw new Error(`ref git inválida: ${base}`);
  try {
    const gitRoot = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    const raw = git(gitRoot, ["log", `${base}..HEAD`, "--format=%H%x1f%B%x1e"]);
    return raw
      .split("\x1e")
      .map((r) => r.replace(/^\s+/, ""))
      .filter(Boolean)
      .map((r) => {
        const [sha, ...rest] = r.split("\x1f");
        return { sha: sha.trim(), message: rest.join("\x1f").trim() };
      });
  } catch {
    return null;
  }
}
