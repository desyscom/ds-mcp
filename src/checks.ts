import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface CheckResult {
  rule: string; // id da regra (ver standards/)
  ok: boolean;
  message: string;
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const has = (root: string, ...f: string[]) => f.some((x) => existsSync(join(root, x)));

/** Checagens determinísticas e somente leitura. Cada uma referencia uma regra documentada. */
export function checkProject(root: string, stacks: string[]): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (rule: string, ok: boolean, message: string) => out.push({ rule, ok, message });

  // ---- all / devops ----
  const gitignore = read(join(root, ".gitignore"));
  add("SEC-003", /(^|\n)\.env\b/.test(gitignore), ".gitignore deve ignorar .env");
  add("devops/repo-basics", has(root, "README.md"), "README.md presente");
  add("devops/repo-basics", has(root, ".editorconfig"), ".editorconfig presente");

  const wf = join(root, ".github", "workflows");
  add(
    "devops/ci",
    existsSync(wf) && readdirSync(wf).length > 0,
    "Pipeline de CI em .github/workflows",
  );

  if (has(root, "Dockerfile")) {
    const df = read(join(root, "Dockerfile"));
    add("devops/docker", /^\s*USER\s+(?!root\b)\S+/im.test(df), "Dockerfile roda como usuário não-root");
    add("devops/docker", !/:latest\b/i.test(df), "Dockerfile não usa tag :latest");
  }

  // ---- web ----
  if (stacks.includes("web")) {
    const pkgRaw = read(join(root, "package.json"));
    add("web/typescript", !!pkgRaw, "package.json presente");
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      add("web/typescript", "typescript" in deps, "TypeScript instalado");
      add("web/tooling", has(root, "package-lock.json", "pnpm-lock.yaml", "yarn.lock"), "Lockfile versionado");
      add("web/tooling", !!pkg.engines?.node || has(root, ".nvmrc", ".node-version"), "Versão do Node fixada");
      add("web/tooling", !!pkg.scripts?.lint && !!pkg.scripts?.test, "Scripts `lint` e `test` definidos");
    }
    const tsconfig = read(join(root, "tsconfig.json"));
    if (tsconfig) add("web/typescript", /"strict"\s*:\s*true/.test(tsconfig), "tsconfig com strict: true");
  }
  return out;
}
