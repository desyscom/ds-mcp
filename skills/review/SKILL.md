---
name: review
description: Revisa as mudanças de um repositório contra os guardrails do ds-mcp e, se estiver instalada, soma o resultado da skill code-review do mattpocock-skills. Somente leitura. Use ao final de uma tarefa ou antes de abrir um PR.
argument-hint: "[base git, ex.: main ou HEAD~3] (opcional)"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git rev-parse *) Bash(git merge-base *) Bash(git branch *) mcp__plugin_ds_ds__get_guardrails mcp__plugin_ds_ds__get_standard mcp__plugin_ds_ds__check_references mcp__plugin_ds_ds__check_language mcp__plugin_ds_ds__check_commits
---

# Revisão contra os guardrails do ds-mcp

Você faz uma revisão **somente leitura**: não edita arquivos, não comenta em PR e não corrige nada, a menos que o usuário peça depois. Julgue só o que foi **adicionado ou alterado**; o legado fora do diff não é tema (DOC-012, SCOPE-001).

## 1. Definir a base da comparação

Base informada pelo usuário: `$ARGUMENTS`. Se vazia, escolha, nesta ordem, e **diga qual escolheu**:

1. há mudanças não commitadas (`git status --short`): base `HEAD`;
2. a branch atual não é a principal: `git merge-base HEAD main` (ou `master`);
3. caso contrário: `HEAD~1`.

Descubra a raiz do repositório com `git rev-parse --show-toplevel`.

## 2. Carregar o contexto

- Leia `.ds-mcp.json` na raiz do projeto (se existir) para obter `stacks` e as exceções em `disable`. Exceção com motivo é decisão do usuário: não a conteste, só a mencione no relatório.
- Chame `get_guardrails` com essas stacks e `phase: "review"`.

## 3. Checagens mecânicas

Chame, com `repo` = raiz e `base` = a base escolhida:

- `check_references`
- `check_language`
- `check_commits` (mensagens dos commits de `base..HEAD`: COMMIT-001 a 003)

O escopo das duas primeiras é tudo o que mudou desde a base: **commits da faixa + alterações não commitadas + arquivos novos ainda não rastreados**. Um achado em arquivo novo ou não commitado é válido mesmo que `git diff <base>` não o mostre: para conferi-lo, leia o arquivo, não o diff.

`check_references` e `check_language` são **heurísticas**: abra cada achado e confirme no código antes de reportar, e descarte só o que for falso positivo de fato (cite o motivo). `check_commits` é determinístico: ERRO de COMMIT-001 é violação.

## 4. Revisão dos guardrails não mecânicos

Leia o diff (`git diff <base>`) e avalie, só nas linhas alteradas, as regras que nenhuma ferramenta verifica: arquitetura e suposições (GEN), escopo (SCOPE), API (API), dependências (DEP), testes (TEST), segurança (SEC), observabilidade (OBS) e as stacks do projeto (REACT, NODE).

Mudança fora do escopo da tarefa, mesmo boa, é **sugestão**, não violação.

## 5. Eixo de Standards e Spec (opcional)

Se a skill `code-review` do plugin `mattpocock-skills` estiver disponível, invoque-a com a mesma base e apresente o resultado dela numa seção própria, **sem mesclar nem reordenar**. Se não estiver instalada, omita a seção sem comentar.

## 6. Relatório

Responda em pt-BR, neste formato:

```
## Revisão ds-mcp — base <ref> (<n> arquivos, <m> commits)

### Violações dos guardrails
[Bloqueante|Alta|Baixa] [ID-DA-REGRA] arquivo:linha — o problema — correção sugerida

### Alertas heurísticos descartados
- arquivo:linha — por que não é violação

### Standards e Spec (code-review)
(só se a skill rodou)

### Divergências com instruções do projeto (PREC-001)
(só se houver)

### Sugestões fora do escopo

Resumo: <n> violações (<x> bloqueantes). Verificado: <o que foi checado>. Não verificado: <o que ficou de fora e por quê>.
```

Classificação:

- **Bloqueante**: achado de nível erro (as ferramentas marcam ERRO) ou violação de segurança (SEC) confirmada.
- **Alta**: violação clara de regra de comportamento (GEN, SCOPE, API, DEP, TEST, REACT, NODE).
- **Baixa**: alerta confirmado (idioma, referência a ADR, tamanho de commit).
- Um alerta **confirmado** é violação (Baixa) e vai em "Violações". Em "Alertas heurísticos descartados" entra **somente** o que você verificou e concluiu que não é violação.

Seja concreto: cite sempre o ID da regra e `arquivo:linha`. Se não houver violações, diga isso e liste o que foi verificado, sem inventar achados.
