import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const OPEN_PR = JSON.stringify({
  number: 1225,
  title: 'chore: citações de issue nos testes',
  state: 'OPEN',
})

type Run = { exitCode: number; stdout?: string; stderr?: string }

// `view` responde ao `gh pr view` da branch atual; `check`, ao `gh pr view 1225`
// que confere o estado do PR depois de um merge com erro.
function fakeGh(on: On, answers: { view: Run; merge?: Run; check?: Run }) {
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    const answer =
      e.argv[2] === 'merge'
        ? answers.merge ?? { exitCode: 0 }
        : e.argv[3] === '1225'
          ? answers.check ?? { exitCode: 0, stdout: '{"state":"OPEN"}' }
          : answers.view
    const value = {
      exitCode: answer.exitCode,
      stdout: answer.stdout ?? '',
      stderr: answer.stderr ?? '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    }
    return { value }
  })
  return calls
}

async function start($: Engine, on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

// O que o engine entrega quando a pessoa digita `/merge-clean <args>` no prompt.
function typed(args: string) {
  return {
    command: 'merge-clean',
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 100 },
  }
}

function mergeCalls(calls: string[][]) {
  return calls.filter(argv => argv[2] === 'merge')
}

test('sem PR aberto na branch, o comando avisa e não faz merge', async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 1, stderr: 'no pull requests found for branch "main"' } })
  await start($, on)

  const { text } = await $.command.run(typed('1225'))
  expect(text).toBe('A branch atual não tem PR aberto (ou o `gh` não está disponível).')
  expect(mergeCalls(calls)).toEqual([])
})

test('sem argumento, só mostra o PR e o comando de confirmação', async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR } })
  await start($, on)

  const { text } = await $.command.run(typed(''))
  expect(text).toBe(
    'PR #1225 · chore: citações de issue nos testes\nPara fazer o merge (squash) e apagar as branches: /merge-clean 1225',
  )
  expect(mergeCalls(calls)).toEqual([])
})

test('número diferente do PR da branch não faz merge', async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR } })
  await start($, on)

  const { text } = await $.command.run(typed('1224'))
  expect(text).toBe('O PR da branch atual é o #1225, não o #1224. Nada foi feito.')
  expect(mergeCalls(calls)).toEqual([])
})

test('com o número do PR da branch, faz o merge e apaga as branches', async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  await start($, on)

  const { text } = await $.command.run(typed('#1225'))
  expect(mergeCalls(calls)).toEqual([['gh', 'pr', 'merge', '1225', '--squash', '--delete-branch']])
  expect(text).toBe('PR #1225: merge feito (squash), branches local e remota apagadas.')
})

test('o merge que falha mostra o motivo', async ($, on) => {
  fakeGh(on, {
    view: { exitCode: 0, stdout: OPEN_PR },
    merge: { exitCode: 1, stderr: 'X Pull request #1225 is not mergeable: the merge commit cannot be cleanly created.\n' },
  })
  await start($, on)

  const { text } = await $.command.run(typed('1225'))
  expect(text).toBe(
    'PR #1225: o merge falhou. X Pull request #1225 is not mergeable: the merge commit cannot be cleanly created.',
  )
})

test('merge feito com erro na limpeza das branches não é reportado como merge falho', async ($, on) => {
  fakeGh(on, {
    view: { exitCode: 0, stdout: OPEN_PR },
    merge: { exitCode: 1, stderr: 'failed to delete local branch chore/citacoes: branch is checked out in another worktree\n' },
    check: { exitCode: 0, stdout: '{"state":"MERGED"}' },
  })
  await start($, on)

  const { text } = await $.command.run(typed('1225'))
  expect(text).toBe(
    'PR #1225: merge feito, mas a limpeza das branches falhou. failed to delete local branch chore/citacoes: branch is checked out in another worktree',
  )
})

test('usa a estratégia de merge configurada', { options: { mergeMethod: 'rebase' } }, async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  await start($, on)

  await $.command.run(typed('1225'))
  expect(mergeCalls(calls)).toEqual([['gh', 'pr', 'merge', '1225', '--rebase', '--delete-branch']])
})

test('estratégia desconhecida no settings cai para squash', { options: { mergeMethod: 'fast-forward' } }, async ($, on) => {
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  await start($, on)

  await $.command.run(typed('1225'))
  expect(mergeCalls(calls)).toEqual([['gh', 'pr', 'merge', '1225', '--squash', '--delete-branch']])
})
