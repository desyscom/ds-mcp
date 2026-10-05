---
title: Escopo
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Alterar só o necessário; melhorias viram sugestão.
---

- `SCOPE-001` Altere somente os arquivos e componentes necessários à tarefa. Isso inclui **não mover, renomear nem reformatar** por preferência de estilo.
  Se identificar melhoria adicional: **não implemente**, registre como sugestão na seção "Sugestões fora do escopo" do relatório final (não como `TODO` no código) e continue a tarefa original. Se a melhoria for pré-requisito para a tarefa, ela está no escopo.
- `SCOPE-002` Não altere comportamento existente para corrigir problema que não faz parte da tarefa (inclui comportamento visual em tarefa exclusivamente backend). Registre como sugestão.
- `SCOPE-003` Prefira a menor alteração que satisfaça o requisito **e mantenha o código correto e coeso**. "Menor" não autoriza gambiarra nem duplicação.
