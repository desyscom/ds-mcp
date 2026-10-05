---
title: Idioma e vocabulário técnico
kind: guardrail
stack: all
phases: [plan, implement, review]
summary: Escrever em pt-BR sem traduzir literalmente o vocabulário técnico.
---

> pt-BR define o **idioma da comunicação**, não a tradução dos termos técnicos.
> Traduza conceitos de negócio; preserve o vocabulário técnico canônico.

- `LANG-001` Escreva em **pt-BR**: comentários, docstrings, documentação (`.md`), ADRs, descrição de commit, texto de PR e issue, descrição de testes e a conversa com o usuário.
  Prefixos de Conventional Commits (`feat:`, `fix:`) ficam em inglês. Strings exibidas ao usuário final e mensagens de log seguem a convenção que o projeto já usa.
- `LANG-002` Não faça tradução literal de vocabulário técnico (`smoke test` ≠ "teste de fumaça", `seed` ≠ "semente", `pipeline` ≠ "canalização", `payload` ≠ "carga útil", `hook` ≠ "gancho", `branch` ≠ "ramificação", `endpoint` ≠ "ponto final").
  Para decidir um termo, siga esta ordem e pare no primeiro que se aplicar:
  1. está no glossário do projeto (`docs/glossary.md`)? use-o;
  2. está no vocabulário-base (`all/vocabulary`, via `get_standard`)? use o termo preferido;
  3. nomeia construção que existe no código (classe, decorator, pasta: service, controller, repository, module, handler)? mantenha em inglês;
  4. é conceito de negócio ou palavra geral (usuário, cliente, venda, banco de dados, autenticação)? use pt-BR;
  5. dúvida? **preserve o termo técnico**, não invente tradução.
- `LANG-003` Nunca traduza nem renomeie: código e identificadores, nomes de API/classe/função/variável, bibliotecas, frameworks e tecnologias, comandos de CLI, chaves de configuração, protocolos, padrões, siglas, nomes de arquivo e mensagens de log/erro citadas literalmente (mantenha em bloco de código).
  O código mantém seu idioma e convenção atuais; a documentação em pt-BR os **explica**, não os altera.
- `LANG-004` Decida pelo **sentido**, não pela palavra: `branch` em git permanece `branch`, em cadastro de empresa é "filial"; `job` técnico permanece `job`, "vaga" é outra coisa; `queue` de mensageria permanece, "fila de atendimento" é negócio.
- `LANG-005` Teste de sanidade: se um desenvolvedor brasileiro experiente estranharia ("ninguém chama isso assim"), não traduza.
- `LANG-006` Use sempre o mesmo termo para o mesmo conceito. Não alterne `deploy`/"implantação"/`deployment`/"publicação". O glossário do projeto prevalece sobre o vocabulário-base.
- `LANG-007` Não crie verbos a partir de anglicismos: escreva "fazer o deploy", "fazer o merge", não "deployar", "mergear".
- `LANG-008` Termo novo que mereça entrar no glossário vai como **sugestão** no relatório final. Não edite `docs/glossary.md` sem pedido (SCOPE-001).

## Exemplos

```ts
// Cria um job para processar os documentos de forma assíncrona.
await queue.add('process-documents', payload);
```

Não: `await fila.adicionar('processar-documentos', cargaUtil);` — o código não muda porque a documentação está em português.

Ruim: "O teste de fumaça roda na canalização depois da mesclagem."
Bom: "O smoke test roda no pipeline depois do merge."
