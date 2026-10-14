import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MergePhase, OpenPr } from '../types'

const pr = atom({ plugin: 'ds', key: 'pr' } as const, null)
const phase = atom({ plugin: 'ds', key: 'phase' } as const, { kind: 'idle' } as MergePhase)

const CONFIRM_MS = 5000
const MERGE_TIMEOUT_MS = 120_000
const METHODS = ['squash', 'merge', 'rebase']
const IDLE: MergePhase = { kind: 'idle' }
const MERGING: MergePhase = { kind: 'merging' }

// O `gh pr view` sem número acha o PR da branch atual do diretório da sessão.
// Sem `gh`, fora de um repositório ou sem PR aberto, a faixa some.
async function refreshPr($: EngineInterface) {
  let found: OpenPr | null = null
  try {
    const { exitCode, stdout } = await $.process.run([
      'gh', 'pr', 'view', '--json', 'number,title,state,headRefName',
    ])
    if (exitCode === 0) {
      const view = JSON.parse(stdout)
      if (view.state === 'OPEN') {
        found = { number: view.number, title: view.title, branch: view.headRefName }
      }
    }
  } catch {
    found = null
  }
  await update($, pr, () => found)
}

function firstLine(text: string) {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

// O merge não tem volta: o primeiro clique só arma a confirmação, e ela
// expira sozinha. O segundo clique dentro da janela roda o merge.
async function press($: EngineInterface, method: string) {
  const current = await read($, phase)
  const now = await $.clock.now()
  if (current.kind === 'merging') return

  if (current.kind === 'idle' || now > current.until) {
    const until = now + CONFIRM_MS
    await update($, phase, (): MergePhase => ({ kind: 'armed', until }))
    $.clock.after(CONFIRM_MS, () => {
      void update($, phase, p => (p.kind === 'armed' && p.until === until ? IDLE : p))
    })
    return
  }

  const target = await read($, pr)
  if (target === null) {
    await update($, phase, () => IDLE)
    return
  }

  await update($, phase, () => MERGING)
  // O `--delete-branch` apaga a branch remota e a local; se a sessão está
  // nela, o `gh` muda antes para a branch base e faz o pull.
  const result = await $.process
    .run(['gh', 'pr', 'merge', String(target.number), `--${method}`, '--delete-branch'], {
      timeoutMs: MERGE_TIMEOUT_MS,
    })
    .catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))

  if (result.exitCode === 0) {
    $.ui.toast(`PR #${target.number}: merge feito, branches local e remota apagadas`)
  } else {
    // O `gh` faz o merge antes de apagar as branches: um erro na limpeza (a
    // branch aberta em outra worktree, por exemplo) sai com código de erro
    // depois do merge feito. O estado do PR diz qual dos dois falhou.
    const reason = firstLine(result.stderr) || firstLine(result.stdout)
    const check = await $.process
      .run(['gh', 'pr', 'view', String(target.number), '--json', 'state'])
      .catch(() => ({ exitCode: 1, stdout: '' }))
    const isMerged = check.exitCode === 0 && JSON.parse(check.stdout).state === 'MERGED'
    $.ui.toast(
      isMerged
        ? `PR #${target.number}: merge feito, mas a limpeza das branches falhou. ${reason}`
        : `PR #${target.number}: o merge falhou. ${reason}`,
    )
  }
  await update($, phase, () => IDLE)
  await refreshPr($)
}

export const register: Register = (on, options) => {
  // O valor vem do settings.json, digitado à mão; fora da lista, vale o squash.
  const configured = String(options.mergeMethod ?? 'squash')
  const method = METHODS.includes(configured) ? configured : 'squash'

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshPr($)
    return result
  })

  // A branch costuma mudar durante um turno (commit, push, `gh pr create`),
  // então o PR é relido ao fim de cada um.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshPr($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const target = await read($, pr)
    // Durante um turno o modelo pode estar mexendo no git; a faixa espera.
    if (e.props.hasSurvey || e.props.isWorking || target === null) {
      return next(e)
    }

    const current = await read($, phase)
    const { Box, Button, Text } = $.ui.resolve(e)
    const label =
      current.kind === 'armed'
        ? `Confirmar merge do #${target.number}?`
        : current.kind === 'merging'
          ? 'Fazendo o merge…'
          : 'Merge (clean)'

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">
          PR #{target.number} · {target.title}
        </Text>
        <Button
          key="merge-clean"
          label={label}
          variant={current.kind === 'armed' ? 'primary' : 'secondary'}
          onPress={() => press($, method)}
        />
      </Box>
    )
  })
}
