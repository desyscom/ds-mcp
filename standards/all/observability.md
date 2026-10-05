---
title: Observabilidade
kind: guardrail
stack: all
phases: [implement, review]
summary: Logs contextualizados, sem dado sensível, sem mexer em nível/retenção globais.
---

- `OBS-002` Não eleve o nível de log global para DEBUG para diagnosticar problema. Use debug escopado, local e temporário, nunca commitado.
- `OBS-003` Use o logger existente do projeto (GEN-002) com contexto. Não espalhe `console.log`, nem deixe um temporário para trás.
- `OBS-004` Não altere retenção de logs sem requisito.

*IDs retirados:* OBS-001 (→ SEC-001: "output" inclui logs).
