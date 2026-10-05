---
title: Princípio central
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Código = verdade do comportamento atual; documentação = verdade das decisões.
---

> O código é a fonte primária da verdade do **comportamento atual**.
> A documentação é a fonte da verdade das **decisões e restrições**.
> Não transforme o código em um índice de navegação da documentação.

**Contexto para decidir ≠ contexto para implementar.** Ao planejar, consulte ADRs e specs à vontade.
Depois da decisão, o código resultante não carrega essas referências consigo (ver DOC-006).

Conflito entre guardrails e instruções do projeto ou pedidos: ver PREC-001..004 (guardrails prevalecem). Conflito entre dois guardrails, ou ambiguidade: GEN-006.
