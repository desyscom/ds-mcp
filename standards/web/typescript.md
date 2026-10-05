---
title: TypeScript
stack: web
tags: [typescript, node]
summary: Config estrita, sem any, validação nas fronteiras.
---

- `tsconfig` com `"strict": true`. Sem `any` implícito; `unknown` + narrowing na fronteira.
- Dados externos (API, env, JSON) são validados com **zod** e o tipo é inferido do schema (`z.infer`).
- Prefira `type` para unions/aliases e `interface` para contratos extensíveis. Sem `enum`; use unions literais.
- ESM (`"type": "module"`). Imports com caminho explícito quando `NodeNext`.
- Erros: lance `Error` (ou subclasses), nunca strings. Não engula exceções silenciosamente.
