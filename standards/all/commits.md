---
title: Mensagens de commit
kind: guardrail
stack: all
phases: [implement, review]
summary: Conventional Commits com descrição em pt-BR.
---

Valem para o que o agente commita (inclusive por skills como `implement`). Aqui a origem **pertence**: `Closes #123` no corpo do commit é correto e esperado (DOC-004 vale só para o código).

- `COMMIT-001` A primeira linha segue **Conventional Commits**: `tipo(escopo opcional): descrição`. Tipos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Um `!` antes dos dois-pontos marca mudança breaking (API-006). Commits de merge, revert e `fixup!`/`squash!` são ignorados.
- `COMMIT-002` A descrição e o corpo em **pt-BR**, com o vocabulário técnico preservado (LANG-001/002). O tipo (`feat`, `fix`...) permanece em inglês.
- `COMMIT-003` A primeira linha tem até **72 caracteres** e descreve a mudança, não o processo ("corrige o total da venda", não "ajustes").

O hook **bloqueia** o commit que viola COMMIT-001 (a correção é barata e feita antes de gravar) e **avisa** nos demais. Projeto que não usa Conventional Commits desliga COMMIT-001 em `.ds-mcp.json` com motivo (PREC-003).
