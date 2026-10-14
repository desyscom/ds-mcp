import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'ds',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const OPEN_PR = JSON.stringify({
  number: 1225,
  title: 'chore: citações de issue nos testes',
  state: 'OPEN',
  headRefName: 'chore/citacoes',
})

type Run = { exitCode: number; stdout?: string; stderr?: string }

// Responde ao `gh` como o host faria e guarda cada argv chamado.
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

function captureToasts(on: On) {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// Faz o papel do engine: abre a sessão e desenha a faixa vazia que ele
// desenharia quando o plugin devolve `next(e)`.
async function startSession($: Engine, on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

test('sem PR aberto na branch, a faixa não mostra o botão', async ($, on) => {
  fakeGh(on, { view: { exitCode: 1, stderr: 'no pull requests found for branch "main"' } })
  await startSession($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'merge-clean' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('durante um turno a faixa esconde o botão', async ($, on) => {
  fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR } })
  await startSession($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })
    expect(await ui.find({ key: 'merge-clean' })).toBeUndefined()
    await ui.unmount()
  }
})

test('o primeiro clique só arma; o segundo faz o merge e apaga as branches', async ($, on) => {
  mock.clock(on)
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  const toasts = captureToasts(on)
  await startSession($, on)

  for (const surface of SURFACES) {
    calls.length = 0
    toasts.length = 0
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'merge-clean' }))?.text).toBe('Merge (clean)')

    await ui.press({ key: 'merge-clean' })
    expect((await ui.find({ key: 'merge-clean' }))?.text).toBe('Confirmar merge do #1225?')
    expect(calls.some(argv => argv[2] === 'merge')).toBe(false)

    await ui.press({ key: 'merge-clean' })
    expect(calls).toContainEqual(['gh', 'pr', 'merge', '1225', '--squash', '--delete-branch'])
    expect(toasts).toEqual(['PR #1225: merge feito, branches local e remota apagadas'])
    await ui.unmount()
  }
})

test('a confirmação expira em 5 segundos sem fazer o merge', async ($, on) => {
  const clock = mock.clock(on)
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR } })
  await startSession($, on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'merge-clean' })
    await clock.advance(5001)
    expect((await ui.find({ key: 'merge-clean' }))?.text).toBe('Merge (clean)')

    // Depois de expirar, um clique volta a só armar.
    await ui.press({ key: 'merge-clean' })
    expect(calls.some(argv => argv[2] === 'merge')).toBe(false)
    await clock.advance(5001)
    await ui.unmount()
  }
})

test('o merge que falha mostra o motivo e devolve o botão', async ($, on) => {
  mock.clock(on)
  fakeGh(on, {
    view: { exitCode: 0, stdout: OPEN_PR },
    merge: { exitCode: 1, stderr: 'X Pull request #1225 is not mergeable: the merge commit cannot be cleanly created.\n' },
  })
  const toasts = captureToasts(on)
  await startSession($, on)

  for (const surface of SURFACES) {
    toasts.length = 0
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'merge-clean' })
    await ui.press({ key: 'merge-clean' })
    expect(toasts).toEqual([
      'PR #1225: o merge falhou. X Pull request #1225 is not mergeable: the merge commit cannot be cleanly created.',
    ])
    expect((await ui.find({ key: 'merge-clean' }))?.text).toBe('Merge (clean)')
    await ui.unmount()
  }
})

test('merge feito com erro na limpeza das branches não é reportado como merge falho', async ($, on) => {
  mock.clock(on)
  fakeGh(on, {
    view: { exitCode: 0, stdout: OPEN_PR },
    merge: { exitCode: 1, stderr: "failed to delete local branch chore/citacoes: branch is checked out in another worktree\n" },
    check: { exitCode: 0, stdout: '{"state":"MERGED"}' },
  })
  const toasts = captureToasts(on)
  await startSession($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'merge-clean' })
  await ui.press({ key: 'merge-clean' })
  expect(toasts).toEqual([
    'PR #1225: merge feito, mas a limpeza das branches falhou. failed to delete local branch chore/citacoes: branch is checked out in another worktree',
  ])
  await ui.unmount()
})

test('usa a estratégia de merge configurada', { options: { mergeMethod: 'rebase' } }, async ($, on) => {
  mock.clock(on)
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  await startSession($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'merge-clean' })
  await ui.press({ key: 'merge-clean' })
  expect(calls).toContainEqual(['gh', 'pr', 'merge', '1225', '--rebase', '--delete-branch'])
  await ui.unmount()
})

test('estratégia desconhecida no settings cai para squash', { options: { mergeMethod: 'fast-forward' } }, async ($, on) => {
  mock.clock(on)
  const calls = fakeGh(on, { view: { exitCode: 0, stdout: OPEN_PR }, merge: { exitCode: 0 } })
  await startSession($, on)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'merge-clean' })
  await ui.press({ key: 'merge-clean' })
  expect(calls).toContainEqual(['gh', 'pr', 'merge', '1225', '--squash', '--delete-branch'])
  await ui.unmount()
})
