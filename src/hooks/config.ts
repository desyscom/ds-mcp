import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Exceção permanente a uma regra. O motivo é obrigatório (PREC-003). */
export interface Disabled {
  rule: string;
  reason: string;
}

/** `.ds-mcp.json` na raiz do projeto. Tudo opcional. */
export interface ProjectConfig {
  /** stacks do projeto, ex.: ["react","nestjs"]. "all" sempre vale. */
  stacks: string[];
  /** exceções válidas (regra + motivo) */
  disable: Disabled[];
  /** entradas de `disable` rejeitadas (sem motivo, ou formato antigo em string): a regra continua ativa */
  invalidDisable: string[];
  /** diretório onde o arquivo foi achado (raiz do projeto), ou null */
  root: string | null;
}

const MIN_REASON = 10;
const empty = (root: string | null): ProjectConfig => ({ stacks: [], disable: [], invalidDisable: [], root });

export function loadProjectConfig(start: string): ProjectConfig {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    const file = join(dir, ".ds-mcp.json");
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8"));
        const cfg = empty(dir);
        cfg.stacks = Array.isArray(raw.stacks) ? raw.stacks.filter((s: unknown): s is string => typeof s === "string") : [];
        for (const d of Array.isArray(raw.disable) ? raw.disable : []) {
          const rule = typeof d === "string" ? d : typeof d?.rule === "string" ? d.rule : "?";
          const reason = typeof d?.reason === "string" ? d.reason.trim() : "";
          if (typeof d === "object" && d !== null && rule !== "?" && reason.length >= MIN_REASON) cfg.disable.push({ rule, reason });
          else cfg.invalidDisable.push(rule);
        }
        return cfg;
      } catch {
        return empty(dir); // arquivo inválido não pode derrubar o agente
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return empty(null);
}
