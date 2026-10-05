---
title: Mudanças de API
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Contratos existentes só mudam com confirmação e consumidores atualizados.
---

- `API-001` Não remova, renomeie nem mude o tipo de campos de resposta existentes sem confirmação. (Adicionar campo opcional não é breaking.)
- `API-003` Não altere status HTTP existente sem necessidade comprovada.
- `API-004` Não altere autenticação/autorização de endpoint existente sem requisito explícito.
- `API-005` Antes de alterar um contrato (endpoint, resposta, DTO compartilhado), localize os **consumidores** conhecidos e atualize os afetados na mesma tarefa.
- `API-006` Identifique explicitamente, no relatório ou PR, toda mudança **breaking**.

*IDs retirados:* API-002 (→ API-001). Absorveu REACT-008, NODE-004, NODE-005 (→ API-005).
