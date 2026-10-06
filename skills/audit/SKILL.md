---
name: audit
description: Auditoria do legado de um projeto contra os guardrails verificáveis do ds-mcp (referências em comentários, idioma e checagens de projeto). Somente leitura; gera um relatório priorizado e não altera nada.
argument-hint: "[caminho, default: raiz do projeto]"
disable-model-invocation: true
allowed-tools: Bash(git rev-parse *) Bash(git ls-files *) mcp__plugin_ds_ds__check_project mcp__plugin_ds_ds__check_references mcp__plugin_ds_ds__check_language mcp__plugin_ds_ds__get_standard
---

# Auditoria do legado

Esta skill descreve **o que já existe** no projeto. É somente leitura: não corrija nada, não edite `.ds-mcp.json` e não abra issues. A limpeza do legado é uma tarefa separada, que o usuário pede depois (SCOPE-001). Os hooks não bloqueiam o legado, só o que o agente adiciona.

## 1. Escopo

Caminho: `$ARGUMENTS`. Se vazio, use a raiz do projeto (`git rev-parse --show-toplevel`; fora de um repositório, o diretório atual).

Stacks: leia `.ds-mcp.json` (se existir). Se não existir, **infira** pelo `package.json` (`react`/`next` → `react`, `@nestjs/*` → `nestjs`) e diga que foi inferido; não crie o arquivo.

## 2. Coleta

Chame, sobre o caminho:

- `check_project` com as stacks;
- `check_references` com `path` (use `limit: 500` para ver mais achados);
- `check_language` com `path` (mesmo `limit`).

O resumo "Por regra" no topo de cada resposta é sempre completo, mesmo quando a lista é cortada. Se houver corte, diga quantos achados ficaram de fora.

## 3. Interpretação

Os verificadores são **heurísticos**. Antes de reportar um grupo de achados, abra amostras no código:

- `DOC-004` (issue, PR, ticket, `TODO(ref)`): verifique se não é um número em outro contexto;
- `LANG-001`/`LANG-002`: comentário legítimo em inglês (citação, nome próprio) e termos do `_Avoid_` que têm outro sentido;
- `DOC-005`/`DOC-006`: ADR referenciado de forma excessiva ou propagada.

Separe o que é provável falso positivo do que é legado real.

## 4. Relatório

Responda em pt-BR:

```
## Auditoria ds-mcp — <caminho>

Stacks: <lista> (<configuradas|inferidas>). Exceções ativas: <regra — motivo>.

### Resumo
<n> achados em <m> arquivos: <x> erros, <y> alertas.

### Por regra
| Regra | Achados | O que significa |

### Arquivos mais afetados
(os 10 primeiros, com a contagem)

### Checagens de projeto
(resultado do check_project)

### Prováveis falsos positivos
- padrão — por que (e se vale uma exceção em `.ds-mcp.json`, com motivo, que **o usuário** deve registrar)

### Ordem sugerida de limpeza (não executada)
1. ...

### O que esta auditoria não cobre
Regras de comportamento (GEN, SCOPE, API, DEP, TEST, SEC) dependem de revisão de mudanças: use `/ds:review`.
```

Ordem de limpeza: primeiro o que for erro e de menor risco (comentário com referência a issue), depois idioma, por último decisões que exigem julgamento. Estime o esforço de cada passo em arquivos, não em horas.
