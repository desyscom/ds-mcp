import type { EngineInterface, Register } from 'claude-code'

const MERGE_TIMEOUT_MS = 120_000
const METHODS = ['squash', 'merge', 'rebase']

type OpenPr = { number: number; title: string }

// O `gh pr view` sem número acha o PR da branch atual do diretório da sessão.
async function currentPr($: EngineInterface): Promise<OpenPr | null> {
  const { exitCode, stdout } = await $.process
    .run(['gh', 'pr', 'view', '--json', 'number,title,state'])
    .catch(() => ({ exitCode: 1, stdout: '' }))
  if (exitCode !== 0) return null
  const view = JSON.parse(stdout)
  return view.state === 'OPEN' ? { number: view.number, title: view.title } : null
}

function firstLine(text: string) {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

async function merge($: EngineInterface, pr: OpenPr, method: string) {
  // O `--delete-branch` apaga a branch remota e a local; se a sessão está
  // nela, o `gh` muda antes para a branch base e faz o pull.
  const result = await $.process
    .run(['gh', 'pr', 'merge', String(pr.number), `--${method}`, '--delete-branch'], {
      timeoutMs: MERGE_TIMEOUT_MS,
    })
    .catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
  if (result.exitCode === 0) {
    return `PR #${pr.number}: merge feito (${method}), branches local e remota apagadas.`
  }

  // O `gh` faz o merge antes de apagar as branches: um erro na limpeza (a
  // branch aberta em outra worktree, por exemplo) sai com código de erro
  // depois do merge feito. O estado do PR diz qual dos dois falhou.
  const reason = firstLine(result.stderr) || firstLine(result.stdout)
  const check = await $.process
    .run(['gh', 'pr', 'view', String(pr.number), '--json', 'state'])
    .catch(() => ({ exitCode: 1, stdout: '' }))
  const isMerged = check.exitCode === 0 && JSON.parse(check.stdout).state === 'MERGED'
  return isMerged
    ? `PR #${pr.number}: merge feito, mas a limpeza das branches falhou. ${reason}`
    : `PR #${pr.number}: o merge falhou. ${reason}`
}

export const register: Register = (on, options) => {
  // O valor vem do settings.json, digitado à mão; fora da lista, vale o squash.
  const configured = String(options.mergeMethod ?? 'squash')
  const method = METHODS.includes(configured) ? configured : 'squash'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'merge-clean',
      description: 'Faz o merge do PR da branch atual e apaga as branches local e remota',
      argumentHint: '[número do PR]',
    })
    return next(e)
  })

  // O merge não tem volta: sem argumento o comando só mostra o PR, e o número
  // digitado é a confirmação. Ele precisa ser o PR da branch atual.
  on('command.run', { command: 'merge-clean' }, async ($, e) => {
    const pr = await currentPr($)
    if (pr === null) {
      return { text: 'A branch atual não tem PR aberto (ou o `gh` não está disponível).' }
    }

    const typed = e.args.trim().replace(/^#/, '')
    if (typed === '') {
      return {
        text: `PR #${pr.number} · ${pr.title}\nPara fazer o merge (${method}) e apagar as branches: /merge-clean ${pr.number}`,
      }
    }
    if (typed !== String(pr.number)) {
      return { text: `O PR da branch atual é o #${pr.number}, não o #${typed}. Nada foi feito.` }
    }

    return { text: await merge($, pr, method) }
  })
}
