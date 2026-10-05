---
title: Docker
stack: devops
tags: [docker]
summary: Imagens pequenas, não-root, versões fixas.
---

- Base com tag fixa (nunca `:latest`); prefira variantes `-slim`/`distroless`.
- Multi-stage build; só artefatos finais na imagem de runtime.
- Rode como usuário não-root (`USER node`).
- `.dockerignore` presente; sem segredos em `ENV`/`ARG`.
