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

export type HelperPhase = 'working' | 'done' | 'failed'

export type StepKind = 'Command' | 'Connector' | 'File read' | 'File write' | 'Skill' | 'Web' | 'Subagent' | 'Tool'

export type Step = {
  kind: StepKind
  /** Rótulo curto da lista de passos: "Gmail · search threads", "pre-outline.md". */
  label: string
  /** Texto apagado depois do rótulo: a pasta de um arquivo. Vazio quando não há. */
  dim: string
  /** O mesmo passo em palavras simples para a linha ao vivo: "Lendo pre-outline.md". */
  live: string
}

/** Um subagente com o card no painel. */
export type Helper = {
  /** O id que `agent.spawn` devolveu; as chamadas e turnos do laço trazem esse id. */
  id: string
  description: string
  /** O tipo do agente: general-purpose, Explore, um agente de plugin. */
  type: string
  /** Modelo para exibir ("Opus 5.5"), vazio enquanto não se sabe. */
  model: string
  /** Esforço pedido pelo engine no último passo, vazio quando não se sabe. */
  effort: string
  phase: HelperPhase
  /** Horário em que começou e, depois de terminar, quando acabou. */
  startedAt: number
  endedAt: number
  /** Quantas chamadas de ferramenta fez no total. */
  count: number
  /** Os últimos 200 passos, do mais antigo ao mais novo; o último é o passo ao vivo. */
  steps: Step[]
  /** Tokens dos turnos terminados, mais os passos do turno em andamento. */
  tokens: number
  turnTokens: number
  /** True depois que o engine informou algum uso. */
  hasUsage: boolean
  /** Índice de início (crescente e único), para a animação da barra e a ordem dos cards. */
  seat: number
  /** Qual das 8 cores de corpo o bichinho usa. */
  hue: number
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      plan: Plan | null
      now: number
      tasks: TrackedTask[]
      ledger: Ledger | null
      /** Subagentes do chat, na ordem de início. */
      helpers: Helper[]
      /** Contador de quadros (bichinhos e giro) e o horário do último tick. */
      helperClock: { tick: number; now: number }
      /** Quais cards mostram a lista completa de passos, e quais grupos estão recolhidos. */
      helperView: { open: string[]; folded: string[] }
      /** Custo total do chat em dólares, null quando o host não guarda. */
      helperCost: { usd: number | null }
      /** Tokens do chat principal somados por turno (cache incluso), para o card "Tokens totais". */
      chatTokens: number
      /** Quadro da animação da barra do plano, avança a cada 600 ms. */
      planTick: number
    }
  }
}
