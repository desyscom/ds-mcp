---
title: Vocabulário técnico base (pt-BR)
kind: standard
stack: all
phases: [implement, review]
summary: Termos preferidos e traduções a evitar. Base do check_language; o docs/glossary.md do projeto sobrescreve.
---

Fonte única de termos para LANG-002. A coluna **Evitar** é verificada automaticamente (`check_language`, só alerta):
só entram traduções que ninguém usa. Palavras em português legítimas (ex.: "implantação", "compilação") **não** ficam em *Evitar*, pois também têm sentido de negócio; a orientação vai em *Observação*.

O `docs/glossary.md` de cada projeto usa as mesmas colunas e **prevalece** sobre esta tabela.

## Jargão: manter em inglês

| Termo | Preferido | Evitar | Observação |
|---|---|---|---|
| smoke test | smoke test | teste de fumaça, fumaça | |
| sanity check | sanity check | teste de sanidade | |
| seed | seed | semente, semeadura | |
| pipeline | pipeline | canalização, encanamento | |
| payload | payload | carga útil | |
| endpoint | endpoint | ponto de extremidade, ponto final de API | |
| pull request | pull request | solicitação de pull, solicitação de mesclagem, pedido de mesclagem | |
| merge | merge | mesclagem, mesclar | verbo: "fazer o merge" |
| branch | branch | ramificação | no sentido de filial de empresa, traduz (LANG-004) |
| commit | commit | confirmação de código | |
| hook | hook | gancho | |
| fixture | fixture | | "acessório" tem sentido de negócio (evento acessório da NF-e, acessório de produto) |
| tree | tree | | "árvore" é a tradução corrente e aceita (árvore de sintaxe, árvore do DOM); "ramo" não traduz tree: é o desvio de uma condição ou o `choice` de um schema |
| build | build | | "compilação" é outra coisa (compile ≠ build) |
| deploy | deploy | | "implantação" tem sentido de negócio (implantação do cliente) |
| rollback | rollback | | |
| release | release | | "lançamento" é aceitável em contexto de produto |
| code review | code review | | "revisão de código" é aceita |
| workflow | workflow | | nome próprio em GitHub Actions |
| hotfix | hotfix | | |
| refactor | refactor | | |
| bootstrap | bootstrap | | |
| middleware | middleware | | |
| request | request | | |
| response | response | | |
| header | header | | |
| cache | cache | | |
| proxy | proxy | | |
| gateway | gateway | | |
| mock | mock | | "simulação" tem sentido geral |
| stub | stub | | |
| spy | spy | | |
| snapshot | snapshot | | |
| regression test | regression test | | |
| handler | handler | | |
| consumer | consumer | | |
| producer | producer | | |
| worker | worker | | |
| job | job | | |
| queue | queue | | |
| retry | retry | | |
| timeout | timeout | | |
| fallback | fallback | | |
| failover | failover | | |
| health check | health check | | |
| feature flag | feature flag | | |
| rate limit | rate limit | | |
| load balancing | load balancing | | |

## Construção do código: manter em inglês

Quando o termo nomeia algo que existe no código (classe, decorator, pasta). No sentido geral, traduza.

| Termo | Preferido | Evitar | Observação |
|---|---|---|---|
| service | service | | "serviço" no sentido de negócio ou de serviço externo |
| controller | controller | | |
| repository | repository | | |
| module | module | | |
| provider | provider | | "provedor" no sentido de negócio (provedor de pagamento) |
| entity | entity | | |
| schema | schema | | |
| migration | migration | | |

## Traduzir: negócio e palavras gerais

| Termo | Preferido | Evitar | Observação |
|---|---|---|---|
| database | banco de dados | | |
| authentication | autenticação | | |
| authorization | autorização | | |
| validation | validação | | |
| transaction | transação | | |
| user | usuário | | em identificadores, vale o código (LANG-003) |
| customer | cliente | | |
| product | produto | | |
| sale | venda | | |
| invoice | nota fiscal | | |
| company | empresa | | |
| password | senha | | |
| permission | permissão | | |
