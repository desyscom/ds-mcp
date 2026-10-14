export type OpenPr = { number: number; title: string; branch: string }

// idle: o botão mostra "Merge (clean)". armed: o primeiro clique pediu
// confirmação, válida até `until`. merging: o `gh pr merge` está rodando.
export type MergePhase =
  | { kind: 'idle' }
  | { kind: 'armed'; until: number }
  | { kind: 'merging' }

declare module 'claude-code' {
  interface PluginState {
    ds: { pr: OpenPr | null; phase: MergePhase }
  }
}
