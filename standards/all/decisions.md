---
title: Destino das decisões de spec
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Cada decisão de spec ou PRD tem um destino, escolhido quando a spec é escrita.
---

**Escopo:** vale ao escrever spec ou PRD, quando a decisão nasce, e ao escrever o código que a cita. Fica fora de `all/documentation` porque precisa carregar no planejamento, e as demais regras de documentação não.

- `DOC-013` Toda decisão de spec ou PRD tem **um** destino, escolhido quando a spec é escrita (tabela abaixo). Spec e PRD não são fonte canônica (DOC-010): fecham, são superados e não levam marca de superação. Por isso o código não os cita, e o ADR não os copia.

## Para onde vai cada decisão

| Destino | Quando |
|---|---|
| ADR | A decisão é difícil de reverter, surpreende sem contexto e resultou de uma escolha real entre alternativas, **e** algum código vai precisar defendê-la |
| Comentário local | O porquê cabe em duas frases junto do código (DOC-002) |
| Glossário | A decisão é de vocabulário |
| Teste ou contrato | É comportamento verificável, e o teste é o guarda |
| Fica na spec | Escopo do dia, história de usuário, valor provisório, preço |

- **Teste da citação:** se nenhum código vai citar a decisão, ela não vira ADR.
- Uma decisão entra em **no máximo um** ADR.
- No código, o ID de decisão (`M8`, `D5`) vem com o ADR que o define na mesma referência: `ADR-0035 M8`, `D5 do ADR-0012`. Sozinho, o ID é local a um documento, e o `M8` de um PRD não é o `M8` de outro.
