---
title: Arquitetura e suposições
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Sem arquitetura/abstração nova sem necessidade; respeitar ADRs; não supor.
---

- `GEN-001` Não introduzir nova arquitetura, padrão ou abstração sem **necessidade demonstrável**.
- `GEN-002` Antes de criar camada, módulo, service, client, logger ou util, verifique se já existe no projeto ou se a funcionalidade cabe na arquitetura atual. Reuse o padrão existente (ex.: o client HTTP padrão) em vez de criar outro.
- `GEN-003` Não criar abstração genérica (componente, função, classe, interface) para um único caso de uso ou único consumidor, salvo necessidade arquitetural (GEN-001).
- `GEN-005` Respeite os ADRs vigentes em `docs/adr/` (não substituídos nem depreciados). Se a implementação contradiz um ADR, **interrompa** e peça decisão arquitetural. Ao planejar algo que toca decisão arquitetural, consulte-os.
- `GEN-006` Não implemente comportamento baseado em suposição não confirmada. Havendo mais de uma interpretação do requisito:
  - se levam a comportamentos materialmente diferentes ou são difíceis de reverter: **pergunte**;
  - se a diferença é pequena e barata de reverter: siga a mais conservadora e **declare a suposição** no relatório final.
- `GEN-007` Não adicione validação, retry, fallback ou tratamento de erro sem **evidência** de necessidade.
  *Exceção*: validação de entrada em fronteiras externas e controles de segurança não dependem de evidência de falha.
- `GEN-009` Não crie compatibilidade retroativa (shims, aliases, flags de legado, campos duplicados) sem requisito explícito. Mudança breaking é feita direto, identificada (API-006) e com consumidores atualizados (API-005).

*IDs retirados:* GEN-004 (→ SCOPE-001), GEN-008 (→ SCOPE-002), GEN-010 (→ SCOPE-003), GEN-011 (→ GEN-006).
