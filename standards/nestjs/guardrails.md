---
title: Guardrails NestJS
kind: guardrail
stack: nestjs
phases: [implement, review]
summary: Camadas, transações, retry, cache, jobs.
---

- `NODE-002` Em projetos com camadas, controller só faz HTTP (parse, delegar, resposta): sem acesso direto a banco e sem lógica de negócio. Não introduza camadas que o projeto não tem (GEN-001).
- `NODE-006` Transação de banco: necessária para vários writes que precisam ser atômicos; nesse caso, é justificada e esperada. Não adicione a leitura nem a write único sem necessidade identificada.
- `NODE-007` Não adicione retry automático em operação que pode não ser idempotente (mesmo havendo evidência de falha, GEN-007 não autoriza isso).
- `NODE-008` Não adicione cache sem requisito ou evidência de necessidade.
- `NODE-009` Não adicione processamento assíncrono/background job para o que pode rodar no fluxo atual sem problema. Se um ADR determina execução assíncrona, vale o ADR (GEN-005).

*IDs retirados:* NODE-001 (→ GEN-002), NODE-003 (→ NODE-002), NODE-004 e NODE-005 (→ API-005).
