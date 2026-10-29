import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadRuleIds } from "../catalog.js";
import { DECISION_PREFIX, TICKET_PREFIX, type ScanOptions } from "../references.js";

/**
 * Exceção permanente a uma regra. O motivo é obrigatório (PREC-003). Com `level: "warn"`, a regra não some: o pedido
 * de confirmação (`ask`) vira aviso e o bloqueio (`deny`) continua.
 */
export interface Disabled {
  rule: string;
  reason: string;
  level?: "warn";
}

/** `.ds-mcp.json` na raiz do projeto. Tudo opcional. */
export interface ProjectConfig {
  /** stacks do projeto, ex.: ["react","nestjs"]. "all" sempre vale. */
  stacks: string[];
  /** exceções válidas (regra + motivo) */
  disable: Disabled[];
  /** entradas de `disable` rejeitadas (sem motivo, ou formato antigo em string): a regra continua ativa */
  invalidDisable: string[];
  /** prefixos da forma "letras, hífen, número" que não contam como chave de ticket (códigos do domínio) */
  ticketKeyIgnore: string[];
  /** entradas de `ticketKeyIgnore` fora do formato (2 a 10 letras maiúsculas): ignoradas */
  invalidTicketKeyIgnore: string[];
  /** prefixos de ID de decisão (`M`, `D`): o ID solto, sem o ADR na mesma referência, gera alerta */
  decisionIdPrefixes: string[];
  /** entradas de `decisionIdPrefixes` fora do formato (1 a 3 letras maiúsculas): ignoradas */
  invalidDecisionIdPrefixes: string[];
  /** diretório onde o arquivo foi achado (raiz do projeto), ou null */
  root: string | null;
}

const MIN_REASON = 10;
const empty = (root: string | null): ProjectConfig => ({
  stacks: [], disable: [], invalidDisable: [], ticketKeyIgnore: [], invalidTicketKeyIgnore: [], decisionIdPrefixes: [], invalidDecisionIdPrefixes: [], root,
});

/** Opções do scanner de referências: as do `.ds-mcp.json` e os IDs de regra dos padrões carregados. */
export const scanOptions = (cfg: ProjectConfig): ScanOptions => ({
  ticketKeyIgnore: cfg.ticketKeyIgnore, decisionIdPrefixes: cfg.decisionIdPrefixes, ruleIds: loadRuleIds(),
});

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
          const level = d?.level;
          if (typeof d === "object" && d !== null && rule !== "?" && reason.length >= MIN_REASON && (level === undefined || level === "warn"))
            cfg.disable.push(level === "warn" ? { rule, reason, level } : { rule, reason });
          else cfg.invalidDisable.push(rule);
        }
        for (const p of Array.isArray(raw.ticketKeyIgnore) ? raw.ticketKeyIgnore : []) {
          if (typeof p === "string" && TICKET_PREFIX.test(p)) cfg.ticketKeyIgnore.push(p);
          else cfg.invalidTicketKeyIgnore.push(String(p));
        }
        for (const p of Array.isArray(raw.decisionIdPrefixes) ? raw.decisionIdPrefixes : []) {
          if (typeof p === "string" && DECISION_PREFIX.test(p)) cfg.decisionIdPrefixes.push(p);
          else cfg.invalidDecisionIdPrefixes.push(String(p));
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
