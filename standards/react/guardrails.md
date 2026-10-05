---
title: Guardrails React
kind: guardrail
stack: react
phases: [implement, review]
summary: Estado, memoização, camada de dados, bibliotecas de UI.
---

- `REACT-002` Não introduza state global quando state local ou estado do servidor for suficiente. Ordem: local → servidor → global.
- `REACT-003` Não duplique estado derivado: calcule durante o render.
- `REACT-004` Não adicione `useMemo`/`useCallback` por otimização preventiva. Vale quando medido, ou por correção (dependência de effect, identidade referencial em componente memoizado).
- `REACT-005` Não altere estrutura de navegação ou roteamento sem requisito explícito.
- `REACT-006` Se o projeto já tem camada de serviços/hooks para acesso a API, não chame APIs direto no componente. Não crie a camada se ela não existir (GEN-001).
- `REACT-010` Não introduza biblioteca de UI para resolver o que os componentes existentes resolvem.

*IDs retirados:* REACT-001 (→ GEN-003), REACT-007 (→ GEN-002), REACT-008 (→ API-005), REACT-009 (→ SCOPE-002).
