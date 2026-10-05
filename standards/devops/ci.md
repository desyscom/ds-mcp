---
title: CI
stack: devops
tags: [ci, github-actions]
summary: Pipeline mínimo em GitHub Actions.
---

- Pipeline em `.github/workflows/` executando: install (frozen lockfile) → lint → typecheck → test → build.
- Fixe versões de actions (tag major ou SHA). Permissões mínimas (`permissions: contents: read`).
- Cache de dependências habilitado. Sem segredos em logs.
