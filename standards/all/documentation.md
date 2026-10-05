---
title: Documentação e referências no código
kind: guardrail
stack: all
phases: [implement, review]
summary: Documente o porquê, não a origem. Código não é índice de documentação.
---

**Escopo:** estas regras valem para código, comentários, docstrings, nomes de teste e `TODO/FIXME`.
**Não valem** para mensagem de commit e descrição de PR: lá a origem (`Closes #123`) é esperada e correta.

## Regras

- `DOC-001` O código deve ser compreensível, em seu comportamento normal, sem consultar documentação externa.
- `DOC-002` Explicação local primeiro: antes de qualquer referência externa, tente explicar a decisão em uma ou duas frases no próprio código. Se isso basta para um desenvolvedor entender e manter, não referencie.
- `DOC-003` Referência externa só quando pelo menos uma for verdadeira:
  1. a regra não cabe numa explicação curta;
  2. a decisão é arquitetural e pode ser desfeita por engano;
  3. existe restrição externa a preservar;
  4. a implementação depende de especificação normativa externa;
  5. a referência é necessária para justificar decisão não intuitiva.
- `DOC-004` Issues, PRs, tickets e conversas **não** são documentação permanente do código. Não referencie, nem em comentário, nem em nome de teste, nem em `TODO/FIXME`.
  Exceção somente se o **usuário ou as regras do projeto** exigirem (ex.: rastreabilidade regulatória) — o agente nunca a decide sozinho.
  - Pendência não vira `TODO`: vai para o relatório (SCOPE-001) ou para a issue.
  - Limitação conhecida vira comentário que **descreve a limitação** ("Não suporta X porque Y").
  - Teste de regressão descreve o comportamento protegido, não o bug de origem.
- `DOC-005` ADR só é referenciado quando representa decisão arquitetural ou restrição não óbvia que precisa ser preservada. `@Injectable() // Conforme ADR-012` não agrega nada.
- `DOC-006` Não propague referências. Ter lido um ADR ao implementar não o leva para todos os arquivos relacionados. A densidade de referências de um arquivo é proporcional às decisões não óbvias **daquele trecho**, não ao volume de documentação da funcionalidade.
- `DOC-007` Não comente o que a implementação já deixa evidente, nem o que o nome já diz, nem a origem da tarefa, nem o processo pelo qual a decisão foi tomada.
- `DOC-008` Comentários explicam principalmente o **porquê**, restrições e comportamentos não óbvios. Formato ideal: *o que acontece + por quê + o que deve ser preservado*.
- `DOC-010` Referência aponta para a **fonte canônica** da decisão e para nada além: sem cadeia (código → issue → PR → doc → doc). Use somente ID estável (`ADR-0017`, os 4 dígitos do arquivo `docs/adr/0017-*.md`), nunca URL, âncora ou número de linha, e uma referência por ponto.
- `DOC-011` Só cite ADR/spec que você **leu** e confirmou que diz o que o comentário afirma. Nunca invente ou "lembre" um número.
- `DOC-012` Estas regras valem para o que você escreve ou modifica. Não remova nem reescreva comentários e referências existentes fora do escopo da tarefa (SCOPE-001). Se um comentário que você já está alterando tem referência obsoleta, corrija-o.

*IDs retirados:* DOC-009 (→ DOC-002).

## Quando referenciar o quê

| Artefato | Referenciar no código? |
|---|---|
| Comentário local | ✅ com frequência |
| ADR | ⚠️ só decisão importante (DOC-005) |
| Especificação normativa | ⚠️ quando necessária (DOC-003.4) |
| API spec | ⚠️ quando o contrato não é evidente |
| Issue / Ticket | ❌ (DOC-004) |
| PR / Conversa | ❌ nunca |
| Documento de planejamento | ❌ normalmente não |

## Exemplos

Ruim — o código diz de onde veio a decisão, não o que faz:

```ts
// Conforme ADR-023 e issue #481,
// não podemos consultar o estoque neste momento.
const venda = await criarVenda();
```

Bom — autocontido:

```ts
// A venda é criada sem consultar o estoque.
// A confirmação de estoque ocorre depois, no fechamento.
const venda = await criarVenda();
```

Bom — o comentário explica a restrição a preservar:

```ts
// Usa o preço capturado no momento da venda.
// Alterações posteriores no cadastro não devem alterar o valor da venda.
const preco = item.precoVenda;
```

Aceitável — decisão arquitetural que alguém poderia desfazer por engano (DOC-005):

```ts
// Processamento assíncrono: esta operação não pode rodar no ciclo da requisição.
// Não alterar para execução síncrona sem revisar ADR-012.
```
