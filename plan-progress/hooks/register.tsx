import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Milestone, Phase, Plan, Todo, TodoStatus, TrackedTask } from '../types'
import { findHome } from './home'
import { registerSubagents, startSubagents, trackSubagentCall } from './subagents'

const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)
const now = atom({ plugin: 'plan-progress', key: 'now' } as const, 0)
const tasks = atom({ plugin: 'plan-progress', key: 'tasks' } as const, [])
// Contador que muda quando os planos do projeto mudam, para a aba redesenhar.
const PLAN_VERSION = { plugin: 'plan-progress', key: 'planVersion' } as const
// Quais marcos estão com a lista de tasks aberta.
const PLAN_VIEW = { plugin: 'plan-progress', key: 'planView' } as const

// O switchboard /mods desliga o mod em todos os chats pelo switches.json.
const NAME = 'plan-progress'
let off = false

const switchesPath = () => `${home}/.claude/mods/switches.json`

async function readSwitch($: EngineInterface) {
  let nowOff = off
  try {
    const path = switchesPath()
    if (await $.fs.exists(path)) {
      const json = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>
      nowOff = json[NAME] === false
    }
  } catch {
    // Um arquivo quebrado não muda nada.
  }
  if (nowOff === off) return
  off = nowOff
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // O próximo redesenho acontece de qualquer forma.
  }
}

const TEST_COMMAND = /\b(pytest|jest|vitest|mocha|tsc|mypy|ruff|eslint|go test|cargo test|npm (run )?test|pnpm test|yarn test|playwright test|plugin (test|validate))\b/
const AUDIT_NAME = /review|audit|security|auditor|reviewer/i
/** Intervalo mínimo entre duas leituras dos planos. */
const LEDGER_REFRESH = 3000
const PLAN_HEADER = /^#\s+(.+?)\s*$/
// Os planos de marco usam "### Task N — título" (travessão); os de ciclo usam ":". \W+ cobre os dois.
const PLAN_TASK = /^###\s+Task\s+([\w.-]+)\W+(.+?)\s*$/
const LEDGER_DONE = /^Task\s+([\w.-]+):\s+complete\b/
const MILESTONE_NUM = /m([0-9]+[a-z]?)/i
// No roadmap, cada linha "| M26 ... | ... | Concluído |" marca o estado do marco.
const ROADMAP_MILESTONE = /^\|\s*M([0-9]+[a-z]?)\b/i

type Plans = { spec: string | null; milestones: Milestone[] }

const phaseOf = (tool: string, input: { command?: string; subagent_type?: string; skill?: string }): Phase | null => {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
    case 'WebSearch':
      return 'pesquisa'
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'AskUserQuestion':
      return 'planejamento'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'construção'
    case 'Bash':
      return TEST_COMMAND.test(input.command ?? '') ? 'teste' : null
    case 'Agent':
      return AUDIT_NAME.test(input.subagent_type ?? '') ? 'auditoria' : 'pesquisa'
    case 'Skill':
      return AUDIT_NAME.test(input.skill ?? '') ? 'auditoria' : null
    default:
      return null
  }
}

const isActive = (current: Plan | null): current is Plan =>
  current !== null && current.todos.some(t => t.status !== 'completed')

const clip = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const join = (dir: string, path: string): string => (path.startsWith('/') ? path : `${dir.replace(/\/$/, '')}/${path}`)

/** Pastas de worktree onde também se procura ledger, relativas ao diretório da sessão. */
const WORKTREE_DIRS = ['.worktrees', '.claude/worktrees']

/** O diretório da sessão e cada worktree dele: em cada um pode haver um `.superpowers/sdd`. */
const projectRoots = async ($: EngineInterface, cwd: string): Promise<string[]> => {
  const roots = [cwd]
  for (const dir of WORKTREE_DIRS) {
    const base = join(cwd, dir)
    const entries = await $.fs.list(base).catch(() => [])
    for (const entry of entries) if (entry.kind === 'dir') roots.push(`${base}/${entry.name}`)
  }
  return roots
}

/** Lê um plano de marco (`docs/superpowers/plans/*.md`), devolvendo o marco (null se não tem tasks). */
const readMilestone = async ($: EngineInterface, planPath: string): Promise<Milestone | null> => {
  const planText = await $.fs.read(planPath).catch(() => null)
  if (typeof planText !== 'string') return null
  const lines = planText.split('\n')
  const title = (lines.find(l => PLAN_HEADER.test(l)) ?? '# Plano').slice(2).trim()
  const tasks = lines
    .map(l => PLAN_TASK.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ id: m[1]!, title: m[2]!, done: false }))
  if (tasks.length === 0) return null
  return { id: '', title, tasks, updatedAt: 0 }
}

/** Coleta os marcos concluídos a partir dos ledgers de ciclo em `.superpowers/sdd/<ciclo>/progress.md`. */
const collectDone = async ($: EngineInterface, root: string): Promise<Set<string>> => {
  const done = new Set<string>()
  const dirs = await $.fs.list(join(root, '.superpowers/sdd')).catch(() => [])
  for (const dir of dirs) {
    if (dir.kind !== 'dir') continue
    const text = await $.fs.read(root + '/.superpowers/sdd/' + dir.name + '/progress.md').catch(() => null)
    if (typeof text !== 'string') continue
    for (const line of text.split('\n')) {
      const m = LEDGER_DONE.exec(line)
      if (m) done.add(m[1].toLowerCase())
    }
  }
  return done
}

/** Coleta os marcos "Concluído" a partir do roadmap (`docs/superpowers/plans/*roadmap*.md`). */
const collectRoadmapDone = async ($: EngineInterface, root: string): Promise<Set<string>> => {
  const done = new Set<string>()
  const plans = await $.fs.list(join(root, 'docs/superpowers/plans')).catch(() => [])
  for (const entry of plans) {
    if (entry.kind !== 'file' || !/roadmap/i.test(entry.name)) continue
    const text = await $.fs.read(root + '/docs/superpowers/plans/' + entry.name).catch(() => null)
    if (typeof text !== 'string') continue
    for (const line of text.split('\n')) {
      const m = ROADMAP_MILESTONE.exec(line)
      if (m && /Conclu/.test(line)) done.add('m' + m[1].toLowerCase())
    }
  }
  return done
}

/** Coleta os marcos com branch já mesclada no git (`git branch --merged`). */
const collectGitDone = async ($: EngineInterface, cwd: string): Promise<Set<string>> => {
  const done = new Set<string>()
  try {
    const r = await $.process.run(['git', 'branch', '--merged', 'HEAD'], { cwd })
    for (const line of r.stdout.split('\n')) {
      const m = MILESTONE_NUM.exec(line)
      if (m) done.add('m' + m[1].toLowerCase())
    }
  } catch {
    // Sem git (ou git falhou): nenhum marco concluído por branch.
  }
  return done
}

/** Varre a spec mais recente e todos os planos (marcos), marcando os concluídos pelo roadmap e pelos ledgers de ciclo. */
const loadPlans = async ($: EngineInterface): Promise<Plans> => {
  const cwd = await $.session.cwd()
  const gitDone = await collectGitDone($, cwd)
  const milestones: Milestone[] = []
  let spec: string | null = null
  for (const root of await projectRoots($, cwd)) {
    const done = await collectDone($, root)
    const roadmapDone = await collectRoadmapDone($, root)
    const allDone = new Set<string>([...gitDone, ...done, ...roadmapDone])
    const plans = await $.fs.list(join(root, 'docs/superpowers/plans')).catch(() => [])
    for (const entry of plans) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md') || /roadmap/i.test(entry.name)) continue
      const slug = entry.name.replace(/\.md$/, '')
      const m = await readMilestone($, root + '/docs/superpowers/plans/' + entry.name)
      if (!m) continue
      const num = MILESTONE_NUM.exec(slug)?.[1]?.toLowerCase() ?? ''
      const isDone = num !== '' && allDone.has('m' + num)
      m.id = slug
      m.tasks = m.tasks.map(t => ({ ...t, done: isDone }))
      milestones.push(m)
    }
    if (spec === null) {
      const specs = await $.fs.list(join(root, 'docs/superpowers/specs')).catch(() => [])
      const newest = specs.filter(e => e.kind === 'file' && e.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name))[0]
      if (newest) {
        const text = await $.fs.read(root + '/docs/superpowers/specs/' + newest.name).catch(() => null)
        if (typeof text === 'string') {
          const title = text.split('\n').find(l => PLAN_HEADER.test(l))
          if (title) spec = title.slice(2).trim()
        }
      }
    }
  }
  const seen = new Set<string>()
  const unique = milestones.filter(m => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => b.id.localeCompare(a.id))
  return { spec, milestones: unique }
}

let lastPlansCheck = Number.NEGATIVE_INFINITY
let cachedPlans: Plans | null = null

/**
 * Relê os planos do projeto (no máximo a cada LEDGER_REFRESH, salvo `force`) e devolve o valor atual.
 * Só grava o contador quando `publish`: escrever estado durante o desenho não vale.
 */
const refreshPlans = async ($: EngineInterface, { force = false, publish = false } = {}): Promise<Plans> => {
  const stamp = await $.clock.now()
  if (!force && stamp - lastPlansCheck < LEDGER_REFRESH) return cachedPlans ?? { spec: null, milestones: [] }
  lastPlansCheck = stamp
  const after = await loadPlans($).catch(() => ({ spec: null as string | null, milestones: [] as Milestone[] }))
  const changed = JSON.stringify(after) !== JSON.stringify(cachedPlans)
  cachedPlans = after
  if (changed && publish) {
    const { value = 0 } = await $.state.get(PLAN_VERSION)
    await $.state.set(PLAN_VERSION, value + 1)
  }
  return after
}

const fromTasks = (list: readonly TrackedTask[]): Todo[] =>
  list.map(t => ({ content: t.subject, activeForm: t.activeForm, status: t.status }))

/** O plano da sessão (TodoWrite/TaskCreate): o objetivo e as tasks, sem os marcos do projeto. */
const sessionTodos = async ($: EngineInterface): Promise<{ goal: string; todos: Todo[] } | null> => {
  const current = await read($, plan)
  const tracked = await read($, tasks)
  const todos: Todo[] = current !== null && current.todos.length > 0 ? current.todos : fromTasks(tracked)
  if (todos.length === 0) return null
  return { goal: current?.goal ?? 'Sessão atual', todos }
}

/** O plano da sessão como um marco único, para o fallback da aba Planos. */
const sessionMilestone = async ($: EngineInterface): Promise<Milestone | null> => {
  const s = await sessionTodos($)
  if (s === null) return null
  return {
    id: 'session',
    title: s.goal,
    tasks: s.todos.map(t => ({ id: t.content, title: t.content, done: t.status === 'completed' })),
    updatedAt: (await read($, plan))?.startedAt ?? (await $.clock.now()),
  }
}

// Quadro da animação da barra do plano: avança a cada 600 ms enquanto o mod está ligado.
const PLAN_TICK = { plugin: 'plan-progress', key: 'planTick' } as const
const PLAN_TICK_MS = 600
const P_MID = '#8b5cf6'
let sid = ''
let home = ''
let planN = 0

// O id e o título da aba de planos, separada da aba de subagentes.
const PLANOS = 'planos'
const PLANOS_TITLE = 'Planos'

/** A visão da aba Planos: spec + marcos do projeto, ou o plano da sessão como fallback. */
async function planView($: EngineInterface): Promise<Plans | null> {
  const plans = await refreshPlans($)
  if (plans.milestones.length > 0) return plans
  const session = await sessionMilestone($)
  return session ? { spec: null, milestones: [session] } : null
}

// Último conteúdo gravado: o arquivo só é regravado quando o plano muda.
let lastPlanKey = ''

/**
 * Grava o plano da sessão em `~/.claude/mods-state/plan-<sessão>.json`. Nunca lança.
 */
async function syncPlanFile($: EngineInterface) {
  if (!sid || !home) return
  try {
    const s = await sessionTodos($)
    if (s === null) return
    const steps = s.todos.map(t => ({ text: t.content, status: t.status }))
    const key = JSON.stringify({ title: s.goal, steps })
    if (key === lastPlanKey) return
    lastPlanKey = key
    // O $.fs.write cria as pastas que faltam, em qualquer sistema.
    const updatedAt = new Date(await $.clock.now()).toISOString()
    await $.fs.write(`${home}/.claude/mods-state/plan-${sid}.json`, `${JSON.stringify({ title: s.goal, steps, updatedAt }, null, 2)}\n`)
  } catch {
    // Gravar o arquivo nunca quebra o painel.
  }
}

// A aba Planos abre sozinha quando há plano. Uma vez por plano: se você fechar, ela não reabre para o mesmo.
let announced: number | string | null = null
async function openPlanPane($: EngineInterface) {
  if (off) return
  const view = await planView($).catch(() => null)
  if (view === null) return
  const key = view.milestones.map(m => m.id).join(',')
  if (announced === key) return
  announced = key
  try {
    await $.ui.open({ id: PLANOS, title: PLANOS_TITLE })
  } catch {
    // Sem painel disponível o plano segue invisível até /planos.
  }
}

export const register: Register = on => {
  lastPlansCheck = Number.NEGATIVE_INFINITY
  cachedPlans = null
  registerSubagents(on, () => off)

  on('session.start', async ($, e, next) => {
    home = await findHome($)
    sid = await $.session.id().catch(() => '')
    await update($, now, () => 0)
    $.clock.every(PLAN_TICK_MS, () => {
      planN += 1
      void $.state.set(PLAN_TICK, planN).catch(() => undefined)
    })
    await refreshPlans($, { force: true, publish: true }).catch(() => undefined)
    await readSwitch($).catch(() => undefined)
    await startSubagents($, () => off)
    await $.command.register({
      name: 'planos',
      description: 'Abre a aba Planos: a spec e os marcos do projeto, com progresso e tasks.',
      immediate: true,
    })
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    $.clock.every(5000, async () => {
      void syncPlanFile($)
      await refreshPlans($, { publish: true }).catch(() => undefined)
      if (isActive(await read($, plan)) || (await read($, tasks)).some(t => t.status !== 'completed')) {
        const stamp = await $.clock.now()
        await update($, now, () => stamp)
      }
      // Abre a aba Planos sozinha quando há planos no projeto.
      await openPlanPane($).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'planos' }, async $ => {
    if (off) return { text: 'O Plan Progress está desligado. Ligue no /mods.' }
    await $.ui.open({ id: PLANOS, title: PLANOS_TITLE })
    return { text: 'Aba Planos aberta.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const current = await read($, plan)
    if (text && !text.startsWith('/') && !isActive(current)) {
      const startedAt = await $.clock.now()
      await update($, plan, () => ({ goal: clip(text, 70), phase: 'pesquisa' as const, todos: [], startedAt }))
      await update($, now, () => startedAt)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    trackSubagentCall($, () => off, e)
    const phase = phaseOf(e.tool, e as { command?: string; subagent_type?: string; skill?: string })
    if (phase !== null) {
      await update($, plan, p => (p === null || p.phase === phase ? p : { ...p, phase }))
    }
    if (e.tool === 'TodoWrite') {
      const todos = e.todos
      const stamp = await $.clock.now()
      await update($, plan, p => {
        const base: Plan = p ?? { goal: 'Sessão atual', phase: 'planejamento', todos: [], startedAt: stamp }
        return { ...base, todos: [...todos], phase: base.todos.length === 0 ? 'planejamento' : base.phase }
      })
      await update($, now, () => stamp)
      if (todos.length > 0) await openPlanPane($)
    }
    const result = await next(e)
    if (e.tool === 'TaskCreate' && 'result' in result && result.result && !result.isError) {
      const created = (result.result as { task?: { id?: string; subject?: string } }).task
      if (created?.id) {
        const id = created.id
        await update($, tasks, list => [
          ...list.filter(t => t.id !== id),
          { id, subject: created.subject ?? e.subject, status: 'pending' as TodoStatus, activeForm: e.activeForm ?? e.subject },
        ])
        await openPlanPane($)
      }
    }
    if (e.tool === 'TaskUpdate' && 'result' in result && !result.isError) {
      const { taskId, subject, activeForm, status } = e
      await update($, tasks, list =>
        status === 'deleted'
          ? list.filter(t => t.id !== taskId)
          : list.map(t =>
              t.id !== taskId
                ? t
                : { ...t, subject: subject ?? t.subject, activeForm: activeForm ?? subject ?? t.activeForm, status: status ?? t.status },
            ),
      )
    }
    if (e.tool === 'Bash') await refreshPlans($, { force: true, publish: true }).catch(() => undefined)
    if (['TodoWrite', 'TaskCreate', 'TaskUpdate'].includes(e.tool)) await syncPlanFile($)
    return result
  }).catch(($, e, next) => next(e))

  // A aba Planos: a spec e os marcos do projeto, ou o plano da sessão como fallback.
  on('ui.render', { component: 'Pane', requestId: PLANOS }, async ($, e, next) => {
    if (off) return next(e)
    // O contador só serve para redesenhar quando os planos mudam.
    await $.state.get(PLAN_VERSION)
    const view = await planView($)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const width = Math.max(32, e.props.bodyColumns)

    if (view === null) {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>Nenhum plano ainda. Crie a spec e os planos em docs/superpowers/, ou use o TodoWrite.</Text>
        </Box>
      )
    }

    const { value: viewState = { open: [] } } = await $.state.get(PLAN_VIEW)
    const open = viewState.open
    const header = view.spec ?? view.milestones[0]?.title ?? 'Plano'

    // Um marco: título, barra, porcentagem e a lista de tasks expansível.
    const milestoneBox = (m: Milestone) => {
      const done = m.tasks.filter(t => t.done).length
      const total = m.tasks.length
      const percent = total === 0 ? 0 : Math.round((done / total) * 100)
      const isOpen = open.includes(m.id)
      const barCols = Math.max(10, width - 4 - 10)
      const fillCols = Math.round((barCols * percent) / 100)
      return (
        <Box key={`m-${m.id}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} marginBottom={1} width={width}>
          <Box flexDirection="row" justifyContent="space-between" width={width - 4}>
            <Text bold wrap="truncate-end">
              {clip(m.title, width - 10)}
            </Text>
            <Text bold color={percent === 100 ? 'success' : undefined}>
              {percent}%
            </Text>
          </Box>
          <Box flexDirection="row" width={width - 4}>
            <Text color={percent === 100 ? '#16a34a' : P_MID}>{'█'.repeat(fillCols)}</Text>
            <Text dimColor>{'░'.repeat(barCols - fillCols)}</Text>
            <Text dimColor>{` ${done}/${total}`}</Text>
          </Box>
          <Button key={`plan-${m.id}`} plain dimColor onPress={() => undefined}>
            {isOpen ? '▾ Ocultar tasks' : `▸ ${total} task${total === 1 ? '' : 's'}`}
          </Button>
          {isOpen
            ? m.tasks.map((t, i) => (
                <Box key={`t-${m.id}-${i}`} flexDirection="row">
                  <Box width={2} flexShrink={0}>
                    {t.done ? <Text color="#16a34a">✓</Text> : <Text dimColor>○</Text>}
                  </Box>
                  <Text dimColor={t.done} strikethrough={t.done} wrap="truncate-end">
                    {`Task ${t.id}: ${t.title}`}
                  </Text>
                </Box>
              ))
            : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Text bold wrap="truncate-end">
          {clip(header, width)}
        </Text>
        {view.milestones.map(milestoneBox)}
      </Box>
    )
  })

  // Alterna a lista de tasks de um marco na aba Planos.
  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    if (off) return next(e)
    if (!e.element.startsWith('plan-')) return next(e)
    const id = e.element.slice('plan-'.length)
    const { value = { open: [] } } = await $.state.get(PLAN_VIEW)
    const openList = value.open
    await $.state.set(PLAN_VIEW, { open: openList.includes(id) ? openList.filter(x => x !== id) : [...openList, id] })
    return { element: e.element }
  })
}
