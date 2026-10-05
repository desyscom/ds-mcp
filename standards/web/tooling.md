---
title: Tooling Node/Web
stack: web
tags: [node, npm, lint, test]
summary: Versão do Node, lockfile, scripts mínimos.
---

- Fixe a versão do Node (`engines.node` e/ou `.nvmrc`).
- Lockfile sempre versionado; um único gerenciador por repo.
- Scripts mínimos no `package.json`: `build`, `lint`, `test`, `dev`.
- ESLint + Prettier (ou Biome) com config no repo; CI falha em erro de lint.
- Testes: Vitest para unit; Playwright para e2e.
