---
title: Testes
kind: guardrail
stack: all
phases: [implement, review]
summary: Testar o especificado; nunca alterar teste só para passar.
---

- `TEST-001` Crie testes para os comportamentos especificados ou modificados pela tarefa (bugfix começa por teste que reproduz).
- `TEST-002` Não crie testes para comportamentos inferidos sem evidência.
- `TEST-003` Se uma alteração quebrar teste existente, determine se (1) o código está errado ou (2) o comportamento esperado mudou. Só no caso 2 o teste muda, com justificativa. Skip, xfail, `.only` ou desabilitar teste/lint contam como "alterar para passar". Supressão de lint inevitável é a mais estreita possível (uma regra, uma linha) e traz o motivo na mesma linha da diretiva.
- `TEST-005` Não remova testes sem justificar a remoção.

*IDs retirados:* TEST-004 (→ TEST-003).
