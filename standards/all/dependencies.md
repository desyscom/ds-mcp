---
title: Dependências
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Dependência nova só se o problema não for resolvível com o que já existe.
---

- `DEP-001` Antes de adicionar dependência, verifique se a funcionalidade já existe no projeto.
- `DEP-003` Informe o motivo da nova dependência (e a alternativa descartada) no relatório ou PR — não em comentário no código.
- `DEP-004` Não atualize dependências não relacionadas à tarefa.
- `DEP-005` Não atualize versões major sem pedido explícito.
- `DEP-006` Uma dependência nova deve resolver um problema que não seja razoavelmente resolvido pelo código ou pelas dependências existentes. Problema trivial (ex.: um `leftPad`) nunca justifica.

*IDs retirados:* DEP-002 (→ DEP-006).
