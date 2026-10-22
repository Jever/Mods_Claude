export type Phase = 'pesquisa' | 'planejamento' | 'construção' | 'teste' | 'auditoria'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type Todo = {
  content: string
  status: TodoStatus
  activeForm: string
}

export type Plan = {
  goal: string
  phase: Phase
  todos: Todo[]
  startedAt: number
}

/** Tarefa criada por TaskCreate e mantida por TaskUpdate. */
export type TrackedTask = {
  id: string
  subject: string
  status: TodoStatus
  activeForm: string
}

/** Progresso lido do ledger de um plano (`.superpowers/sdd/<plano>/progress.md`). */
export type Ledger = {
  planPath: string
  title: string
  tasks: { id: string; title: string; done: boolean }[]
  updatedAt: number
  seenAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      plan: Plan | null
      now: number
      isExpanded: boolean
      tasks: TrackedTask[]
      ledger: Ledger | null
    }
  }
}
