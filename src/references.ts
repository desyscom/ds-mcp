import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { commentTexts, HASH_EXT, SLASH_EXT } from "./comments.js";

export type Severity = "error" | "warn";

export interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: Severity;
  message: string;
  snippet: string;
}

export const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage", ".turbo"]);
export const MAX_FILE_BYTES = 512 * 1024;

/** Título de teste (describe/it/test): DOC-004 vale para nomes de teste. */
export function testTitle(line: string): string | null {
  const m = /\b(?:describe|it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\1/.exec(line);
  return m ? m[2] : null;
}

/** Prefixos da forma "letras, hífen, número" que não são chave de ticket. O projeto soma os seus em `ticketKeyIgnore`. */
const NOT_TICKET = [
  // normas, formatos e protocolos
  "ADR", "SPEC", "REQ", "RN", "RF", "UTF", "ISO", "SHA", "RFC", "CVE", "CWE", "HTTP", "TLS", "MD", "ES", "IEEE", "WCAG", "ECMA", "UTC", "GMT", "TCP", "IPV", "PT", "EN",
  // algoritmos com tamanho de chave
  "AES", "RSA", "DES", "ECDSA",
  // máscaras de data e hora seguidas de valor fixo
  "YYYY", "YY", "MM", "DD", "HH",
];
/** Prefixo aceito em `ticketKeyIgnore`: o mesmo formato que a chave de ticket exige. */
export const TICKET_PREFIX = /^[A-Z]{2,10}$/;

/** Prefixo aceito em `decisionIdPrefixes`: o ID de decisão é letra e número (`M8`, `D5`). */
export const DECISION_PREFIX = /^[A-Z]{1,3}$/;

export interface ScanOptions {
  /** prefixos extras que não são ticket, validados por TICKET_PREFIX */
  ticketKeyIgnore?: readonly string[];
  /** prefixos de ID de decisão, validados por DECISION_PREFIX; sem eles, o alerta de ID solto fica desligado */
  decisionIdPrefixes?: readonly string[];
  /** IDs de regra dos padrões (`loadRuleIds`): têm o formato de chave de ticket, mas nomeiam um guardrail */
  ruleIds?: ReadonlySet<string>;
}

const ticketKeyCache = new Map<string, RegExp>();
/**
 * Chave de ticket tem prefixo só de letras. Prefixo com dígito é código de outra coisa: regra de validação do
 * Manual da NF-e (letra e dígitos antes do hífen) ou fragmento de classe de caractere de regex.
 */
function ticketKey(ignore: readonly string[] = []): RegExp {
  const key = ignore.join("|");
  let re = ticketKeyCache.get(key);
  if (!re) {
    re = new RegExp(`\\b(?!(?:${[...NOT_TICKET, ...ignore].join("|")})-)[A-Z]{2,10}-\\d+\\b`, "g");
    ticketKeyCache.set(key, re);
  }
  return re;
}

/** Um ID de regra não esconde o ticket que divide a linha com ele: cada chave é avaliada sozinha. */
function hasTicketKey(text: string, opts: ScanOptions): boolean {
  for (const m of text.matchAll(ticketKey(opts.ticketKeyIgnore))) if (!opts.ruleIds?.has(m[0])) return true;
  return false;
}

const decisionIdCache = new Map<string, RegExp>();
/**
 * ID de decisão sem zero à esquerda: `M01` é grupo do leiaute fiscal, não decisão. Não há lista embutida porque
 * `S3`, `T1` e afins são siglas comuns, e só o projeto sabe quais prefixos seus documentos usam.
 */
function decisionId(prefixes: readonly string[]): RegExp {
  const key = prefixes.join("|");
  let re = decisionIdCache.get(key);
  if (!re) {
    re = new RegExp(`\\b(?:${key})[1-9]\\d{0,2}\\b`);
    decisionIdCache.set(key, re);
  }
  return re;
}

// "segundo" só cita como preposição; depois de artigo ou determinante é ordinal ("o segundo fator").
const SEGUNDO = String.raw`(?<!\b(?:o|um|do|no|ao|pelo|este|esse|seu|nosso)\s)segundo`;
const RE = {
  issueNumber: /(?:^|[^\w&])#\d{1,6}\b/,
  issueWord: /\b(?:issue|ticket|PR|pull request|merge request|MR|chamado|card)\s*(?:n[ºo°.]?\s*)?#?\d+/i,
  tracker: /(github\.com\/\S+\/(?:issues|pull)\/\d+|atlassian\.net|\bjira\.|linear\.app|gitlab\.\S+\/-\/(?:issues|merge_requests)|_workitems|trello\.com|notion\.so|slack\.com)/i,
  discussion: new RegExp(String.raw`\b(?:conforme|${SEGUNDO}|ver|veja|cf\.|ref\.?|combinado|alinhado|definido)\b[^.]{0,40}\b(?:discuss[ãa]o|conversa|thread|reuni[ãa]o|slack|teams|whatsapp)\b`, "i"),
  // Os dois canais abaixo são palavras comuns no código (o endereço de um usuário, o local de uma chamada): só
  // contam colados ao particípio que marca a citação.
  discussionChannel: /\b(?:combinad[oa]|alinhad[oa]|discutid[oa]|acordad[oa])\s+(?:(?:por|em|via|n[oa]|pel[oa])\s+)?(?:e-?mail|call)\b/i,
  todo: /\b(TODO|FIXME|HACK|XXX)\b(.*)/,
  adr: /\bADR[- ]?(\d+)/i,
  spec: /\b(?:SPEC|REQ|RN|RF)-\d+\b|\bRFC\s?\d+|\bconforme\s+(?:a\s+)?(?:spec|especifica[çc][ãa]o|requisito)/i,
  url: /https?:\/\/\S+/,
};

/**
 * Lista de números com `#` ligada por `/`, `·` ou "e": o qualificador do primeiro vale para todos. `digits` limita o
 * tamanho de cada número.
 */
const numberList = (digits: string) => {
  const one = String.raw`#\d${digits}[a-z]?\b`;
  return String.raw`${one}(?:\s*[/·]\s*${one}|\s+e\s+${one})*`;
};
/**
 * Número com `#` que não é issue: a decisão numerada colada ao ID do ADR, a regra de negócio numerada de um anexo
 * (depois de `RN` ou antes de "do anexo") e o número da norma PKCS. Separado do ADR por vírgula, ponto e vírgula ou
 * outra palavra, o número volta a ser issue: é assim que o código cita o ADR junto da issue que o motivou. O número
 * de decisão tem até dois dígitos pelo mesmo motivo: com três ou mais, colado ao ADR, é a issue.
 */
const NOT_ISSUE = new RegExp(String.raw`\bADR[- ]?\d+\s+${numberList("{1,2}")}|\bRN\s+${numberList("+")}|${numberList("+")}(?=\s+do\s+anexo)|\bPKCS\s?#\d+`, "gi");
const withoutNumberedRules = (text: string) => text.replace(NOT_ISSUE, "");

/**
 * Trecho de código inline com mais que o ID mostra o formato de uma referência, não a cita. O ID sozinho entre crases
 * continua sendo citação: o projeto que escreve as citações assim não perde o alerta nem a contagem de propagação.
 */
const withoutFormatExamples = (text: string) => text.replace(/`([^`]*)`/g, (span, inner: string) => (/^ADR[- ]?\d+$/i.test(inner.trim()) ? span : ""));

function scanText(text: string, kind: "comment" | "test", opts: ScanOptions): Omit<Finding, "file" | "line" | "snippet">[] {
  const out: Omit<Finding, "file" | "line" | "snippet">[] = [];
  const add = (rule: string, severity: Severity, message: string) => out.push({ rule, severity, message });

  const tracker = RE.issueNumber.test(withoutNumberedRules(text)) || RE.issueWord.test(text) || hasTicketKey(text, opts) || RE.tracker.test(text);
  if (tracker) add("DOC-004", "error", "referência a issue/PR/ticket — descreva o comportamento, não a origem");
  if (RE.discussion.test(text) || RE.discussionChannel.test(text)) add("DOC-004", "error", "referência a conversa/discussão — consolide a decisão num ADR ou explique localmente");

  if (kind === "comment") {
    const todo = RE.todo.exec(text);
    if (todo) {
      const withRef = /\(.+\)|:\s*\S+-\d+|#\d+/.test(withoutNumberedRules(todo[2]));
      if (withRef) add("DOC-004", "error", `${todo[1]} com referência — pendência vai para o relatório/issue`);
      else add("SCOPE-001", "warn", `${todo[1]} no código — registre como sugestão no relatório; limitação conhecida vira comentário descritivo`);
    }
    if (RE.adr.test(withoutFormatExamples(text))) add("DOC-005", "warn", "referência a ADR — só se for decisão/restrição não óbvia a preservar (DOC-003/005); explique localmente (DOC-002)");
    if (RE.spec.test(text)) add("DOC-003", "warn", "referência normativa/spec — confirme que se enquadra em DOC-003");
    if (RE.url.test(text) && !tracker) add("DOC-010", "warn", "URL em comentário — prefira ID estável da fonte canônica");
    // O ADR qualifica qualquer ID da linha, na forma que o projeto usar: `ADR-35 M8`, `D5 do ADR-12`, `ADR plataforma-29, D5`.
    if (opts.decisionIdPrefixes?.length && decisionId(opts.decisionIdPrefixes).test(text) && !/\bADR\b/i.test(text))
      add("DOC-013", "warn", "ID de decisão sem o ADR — o ID é local ao documento que o define; qualifique-o (`ADR-0035 M8`) ou explique localmente");
  }
  return out;
}

/**
 * `source` é o texto de onde `lines` saiu, inteiro: o hook avalia só as linhas adicionadas, que vêm com lacunas, e o
 * bloco aberto numa linha que já existia continua valendo para as novas.
 */
export function scanLines(file: string, lines: { n: number; text: string }[], ext: string, opts: ScanOptions = {}, source = lines): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const comments = commentTexts(source, ext);
  for (const { n, text } of lines) {
    const targets: { s: string; kind: "comment" | "test" }[] = [];
    const c = comments.get(n);
    if (c !== undefined) targets.push({ s: c, kind: "comment" });
    const t = testTitle(text);
    if (t !== null) targets.push({ s: t, kind: "test" });
    for (const { s, kind } of targets) {
      for (const f of scanText(s, kind, opts)) {
        const key = `${n}:${f.rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ file, line: n, snippet: text.trim().slice(0, 140), ...f });
      }
    }
  }
  return found;
}

export function walk(p: string): string[] {
  const st = statSync(p);
  if (st.isFile()) return [p];
  return readdirSync(p).flatMap((name) => (SKIP_DIRS.has(name) ? [] : walk(join(p, name))));
}

/** DOC-006: muitas referências a ADR/spec no mesmo arquivo, ou o mesmo ADR espalhado por vários arquivos. */
function propagation(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  const perFile = new Map<string, Finding[]>();
  const perAdr = new Map<string, Set<string>>();
  for (const f of findings.filter((x) => x.rule === "DOC-005" || x.rule === "DOC-003")) {
    perFile.set(f.file, [...(perFile.get(f.file) ?? []), f]);
    const id = /ADR[- ]?(\d+)/i.exec(f.snippet)?.[1];
    if (id) perAdr.set(id, (perAdr.get(id) ?? new Set()).add(f.file));
  }
  for (const [file, fs] of perFile)
    if (fs.length >= 3)
      out.push({ file, line: fs[0].line, rule: "DOC-006", severity: "warn", snippet: "", message: `${fs.length} referências documentais no mesmo arquivo — densidade proporcional às decisões não óbvias do trecho` });
  for (const [id, files] of perAdr)
    if (files.size >= 3)
      out.push({ file: [...files][0], line: 0, rule: "DOC-006", severity: "warn", snippet: "", message: `ADR-${id} aparece em ${files.size} arquivos — possível propagação de referência` });
  return out;
}

/** Linhas adicionadas de um diff unificado, por arquivo, com o número da linha no arquivo novo. */
export function parseDiff(diff: string): Map<string, { n: number; text: string }[]> {
  let file = "";
  let n = 0;
  const byFile = new Map<string, { n: number; text: string }[]>();
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) file = raw.slice(4).replace(/^b\//, "");
    else if (raw.startsWith("@@")) n = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0) - 1;
    else if (raw.startsWith("+")) { n++; byFile.set(file, [...(byFile.get(file) ?? []), { n, text: raw.slice(1) }]); }
    else if (!raw.startsWith("-")) n++;
  }
  return byFile;
}

export function checkReferences(input: { path?: string; diff?: string }, opts: ScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  if (input.diff) {
    const byFile = parseDiff(input.diff);
    for (const [f, lines] of byFile) findings.push(...scanLines(f, lines, extname(f), opts));
  } else if (input.path) {
    const root = input.path;
    const isFile = statSync(root).isFile();
    for (const file of walk(root)) {
      const ext = extname(file);
      if (!SLASH_EXT.has(ext) && !HASH_EXT.has(ext)) continue;
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
      findings.push(...scanLines(isFile ? file : relative(root, file), lines, ext, opts));
    }
  }
  return [...findings, ...propagation(findings)];
}

/** Referências indevidas em linhas já coletadas (ex.: mudanças do git). */
export function checkReferencesFiles(files: Map<string, { n: number; text: string }[]>, opts: ScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  for (const [file, lines] of files) findings.push(...scanLines(file, lines, extname(file), opts));
  return [...findings, ...propagation(findings)];
}

export function formatFindings(findings: Finding[], opts: { limit?: number; empty?: string } = {}): string {
  if (!findings.length) return opts.empty ?? "Nenhuma referência suspeita encontrada.";
  const limit = opts.limit ?? 200;
  const errors = findings.filter((f) => f.severity === "error").length;
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const summary = [...byRule].sort((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ×${n}`).join(", ");
  // erros primeiro: se houver corte, o que fica visível é o mais grave
  const ordered = [...findings].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
  const rows = ordered.slice(0, limit).map((f) => `${f.severity.toUpperCase().padEnd(5)} ${f.rule}  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.message}${f.snippet ? `
        > ${f.snippet}` : ""}`);
  const cut = findings.length > limit ? `

… ${findings.length - limit} achado(s) omitido(s) (limit=${limit}).` : "";
  return `${errors} erro(s), ${findings.length - errors} alerta(s)
Por regra: ${summary}

${rows.join("\n")}${cut}`;
}
