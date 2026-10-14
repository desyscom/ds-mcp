/**
 * Texto de comentário por análise léxica: o lexer anda pelo código e pula string, template literal, regex e string
 * crua, então `//` dentro de uma URL entre aspas, de um base64 ou de uma regex não abre comentário, e `/*` abre em
 * qualquer posição do código (depois de `=`, `[`, `{` do JSX). O conteúdo de um template literal nunca é comentário.
 */

export const SLASH_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".cs", ".go", ".kt", ".rs", ".c", ".cpp", ".css", ".scss"]);
export const HASH_EXT = new Set([".py", ".sh", ".rb", ".yml", ".yaml", ".toml"]);

export interface Line {
  n: number;
  text: string;
}

/** O que cada família de linguagem tem além de `/* *\/` e da string entre aspas duplas. */
interface Dialect {
  /** `//` abre comentário de linha; CSS puro não tem */
  line: boolean;
  /** aspa simples: string (JS, CSS) ou literal de caractere, que fecha logo ou não delimita nada (lifetime do Rust) */
  quote: "string" | "char";
  /** crase: template literal com `${}` (JS), string crua de várias linhas (Go, identificador do Kotlin) ou nada */
  backtick: "template" | "raw" | null;
  /** `/` depois de operador abre regex (JS) */
  regex: boolean;
  /** `"""` abre bloco de texto (Java, Kotlin, C#) */
  triple: boolean;
  /** `@"` abre string verbatim, de várias linhas e com `""` como escape (C#) */
  verbatim: boolean;
}

const C_LIKE: Dialect = { line: true, quote: "char", backtick: null, regex: false, triple: false, verbatim: false };
const JS: Dialect = { ...C_LIKE, quote: "string", backtick: "template", regex: true };
const DIALECTS: Record<string, Dialect> = {
  ".ts": JS, ".tsx": JS, ".js": JS, ".jsx": JS, ".mjs": JS, ".cjs": JS,
  ".css": { ...C_LIKE, line: false, quote: "string" },
  ".scss": { ...C_LIKE, quote: "string" },
  ".go": { ...C_LIKE, backtick: "raw" },
  ".kt": { ...C_LIKE, backtick: "raw", triple: true },
  ".java": { ...C_LIKE, triple: true },
  ".cs": { ...C_LIKE, triple: true, verbatim: true },
};

/** Onde o lexer está: no código, numa continuação de bloco que abriu antes do trecho, ou num literal de várias linhas. */
type State = "code" | "block" | "template" | "raw" | "triple";

interface Span {
  start: number;
  end: number;
}

// Palavras depois das quais `/` começa uma expressão, e portanto uma regex.
const KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const WORD = /[\p{ID_Continue}$]/u;
const CHAR_LITERAL = /'(?:\\.[^'\n]{0,9}|[^\\'\n])'/y;
const isEol = (c: string | undefined) => c === "\n" || c === "\r";

/** Fim de string entre aspas: a aspa de fecho ou o fim da linha, que encerra string não terminada. */
function quotedEnd(src: string, i: number, q: string): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === q) return j + 1;
    else if (isEol(c)) return j;
    else j++;
  }
  return j;
}

/** Fim de regex literal: a barra fora de classe de caractere, mais as flags; o fim da linha encerra o que não fechou. */
function regexEnd(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (isEol(c)) return j;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "/" && !inClass) {
      j++;
      while (/[a-z]/i.test(src[j] ?? "")) j++;
      return j;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    j++;
  }
  return j;
}

/** Fim de string verbatim do C#: a aspa que não é seguida de outra. */
function verbatimEnd(src: string, i: number): number {
  let j = i + 2;
  while (j < src.length) {
    if (src[j] === '"') {
      if (src[j + 1] !== '"') return j + 1;
      j += 2;
    } else j++;
  }
  return j;
}

/**
 * Comentários de `src`, a partir do estado `start`. `end` é o estado ao fim do texto: num literal de várias linhas,
 * o trecho terminou antes do fecho ou começou depois da abertura.
 */
function lex(src: string, d: Dialect, start: State): { spans: Span[]; end: State } {
  const spans: Span[] = [];
  const n = src.length;
  const braces: number[] = []; // `{` abertos dentro de cada `${` em curso
  let state: State = start;
  let operand = false; // o último token fecha um operando: `/` em seguida é divisão, não regex
  let i = 0;

  // Continuação de bloco cuja abertura ficou antes do trecho: vale enquanto as linhas começarem com `*`.
  if (state === "block") {
    while (i < n) {
      const eol = src.indexOf("\n", i);
      const lineEnd = eol < 0 ? n : eol;
      const line = src.slice(i, lineEnd);
      if (!/^\s*\*/.test(line)) break;
      const close = line.indexOf("*/");
      if (close >= 0) {
        spans.push({ start: i, end: i + close + 2 });
        i += close + 2;
        break;
      }
      spans.push({ start: i, end: lineEnd });
      i = lineEnd + 1;
    }
    state = "code";
  }

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    if (state === "template") {
      if (c === "\\") {
        i += 2;
      } else if (c === "`") {
        state = "code";
        operand = true;
        i++;
      } else if (c === "$" && next === "{") {
        braces.push(0);
        state = "code";
        operand = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (state === "raw" || state === "triple") {
      const close = state === "raw" ? "`" : '"""';
      const e = src.indexOf(close, i);
      if (e < 0) break;
      state = "code";
      operand = true;
      i = e + close.length;
      continue;
    }

    if (c === "/" && next === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      spans.push({ start: i, end });
      i = end;
      continue;
    }
    // `:` antes do `//` é URL fora de string, como no texto do JSX
    if (c === "/" && next === "/" && d.line && src[i - 1] !== ":") {
      let e = i + 2;
      while (e < n && !isEol(src[e])) e++;
      spans.push({ start: i + 2, end: e });
      i = e;
      continue;
    }
    if (d.triple && src.startsWith('"""', i)) {
      state = "triple";
      i += 3;
      continue;
    }
    if (c === "`" && d.backtick) {
      state = d.backtick;
      i++;
      continue;
    }

    if (d.verbatim && c === "@" && next === '"') {
      i = verbatimEnd(src, i);
      operand = true;
    } else if (c === '"' || (c === "'" && d.quote === "string")) {
      i = quotedEnd(src, i, c);
      operand = true;
    } else if (c === "'") {
      CHAR_LITERAL.lastIndex = i;
      i = CHAR_LITERAL.test(src) ? CHAR_LITERAL.lastIndex : i + 1;
      operand = true;
    } else if (c === "/" && d.regex && !operand && src[i - 1] !== "<") {
      // `</` é a tag de fecho do JSX, nunca regex
      i = regexEnd(src, i);
      operand = true;
    } else if (WORD.test(c)) {
      let e = i + 1;
      while (e < n && WORD.test(src[e])) e++;
      operand = !KEYWORDS.has(src.slice(i, e));
      i = e;
    } else if ((c === "+" || c === "-") && next === c) {
      i += 2; // `a++ / 2` segue operando; `++` prefixo não precede `/`
    } else if (c === "}" && braces.length && braces[braces.length - 1] === 0) {
      braces.pop();
      state = "template";
      i++;
    } else {
      if (braces.length && c === "{") braces[braces.length - 1]++;
      if (braces.length && c === "}") braces[braces.length - 1]--;
      if (!/\s/.test(c)) operand = c === ")" || c === "]" || c === "}";
      i++;
    }
  }
  return { spans, end: state };
}

/** Trechos de linhas com números consecutivos: num diff, o que vem depois de uma lacuna pode ser outro contexto. */
function runs(lines: readonly Line[]): Line[][] {
  const out: Line[][] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && l.n === last[last.length - 1].n + 1) last.push(l);
    else out.push([l]);
  }
  return out;
}

function slashComments(run: Line[], d: Dialect, out: Map<number, string>): void {
  const texts = run.map((l) => l.text);
  // shebang na primeira linha do arquivo não é código
  if (run[0].n === 1 && texts[0].startsWith("#!")) texts[0] = "";
  const src = texts.join("\n");
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) {
    starts.push(at);
    at += t.length + 1;
  }
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const found = new Map<number, string[]>();
  const collect = (spans: Span[], skipKnown: boolean) => {
    const known = new Set(found.keys());
    for (const { start, end } of spans) {
      for (let k = lineAt(start); k <= lineAt(Math.max(start, end - 1)); k++) {
        if (skipKnown && known.has(k)) continue;
        const seg = src.slice(Math.max(start, starts[k]), Math.min(end, starts[k] + texts[k].length));
        if (seg.trim()) found.set(k, [...(found.get(k) ?? []), seg]);
      }
    }
  };

  // No diff e no Edit, o trecho pode começar no meio de um bloco: a linha que começa com `*` é continuação.
  const first = lex(src, d, /^\s*\*/.test(texts[0]) ? "block" : "code");
  collect(first.spans, false);
  // Terminar dentro de um literal de várias linhas é ambíguo: ou o trecho acabou antes do fecho, ou a crase (ou o
  // `"""`) fechava um literal aberto antes do trecho. A segunda leitura completa a primeira nas linhas que ela não leu.
  if (first.end === "template" || first.end === "raw" || first.end === "triple") collect(lex(src, d, first.end).spans, true);

  for (const [k, segs] of found) out.set(run[k].n, segs.join(" "));
}

/** Texto de comentário de cada linha, por número. O estado léxico não atravessa lacuna na numeração. */
export function commentTexts(lines: readonly Line[], ext: string): Map<number, string> {
  const out = new Map<number, string>();
  if (SLASH_EXT.has(ext)) {
    const d = DIALECTS[ext] ?? C_LIKE;
    for (const run of runs(lines)) slashComments(run, d, out);
  } else if (HASH_EXT.has(ext)) {
    for (const { n, text } of lines) {
      if (text.trim().startsWith("#!")) continue;
      const m = /(?:^|\s)#(.*)$/.exec(text);
      if (m) out.set(n, m[1]);
    }
  }
  return out;
}
