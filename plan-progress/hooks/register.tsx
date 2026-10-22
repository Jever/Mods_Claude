import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ledger, Phase, Plan, Todo, TodoStatus, TrackedTask } from '../types'
import { nestable, PANE, registerSubagents, startSubagents, TITLE, trackSubagentCall } from './subagents'

const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)
const now = atom({ plugin: 'plan-progress', key: 'now' } as const, 0)
const tasks = atom({ plugin: 'plan-progress', key: 'tasks' } as const, [])
const ledger = atom({ plugin: 'plan-progress', key: 'ledger' } as const, null)

// O switchboard /mods desliga o mod em todos os chats pelo switches.json.
const NAME = 'plan-progress'
let off = false

const switchesPath = ($: EngineInterface) => `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/switches.json`

async function readSwitch($: EngineInterface) {
  let nowOff = off
  try {
    const path = switchesPath($)
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
/** Ledger concluído some da faixa depois deste tempo sem mudança. */
const LEDGER_DONE_TTL = 10 * 60 * 1000
/** Intervalo mínimo entre duas leituras do ledger. */
const LEDGER_REFRESH = 3000
const LEDGER_HEADER = /^# SDD ledger\s+\S+\s+plan:\s*(.+?)\s*$/
const PLAN_TASK = /^###\s+Task\s+([\w.-]+):\s*(.+?)\s*$/
const LEDGER_DONE = /^Task\s+([\w.-]+):\s+complete\b/

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

const percentOf = (items: readonly Todo[]): number =>
  items.length === 0 ? 0 : Math.round((items.filter(t => t.status === 'completed').length / items.length) * 100)

const elapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
    : `${minutes}m${String(total % 60).padStart(2, '0')}s`
}

const bar = (percent: number, width = 20): string => {
  const filled = Math.round((percent / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

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

/** Lê o ledger mais recente em `<raiz>/.superpowers/sdd/*\/progress.md` e o plano que ele nomeia. */
const loadLedger = async ($: EngineInterface, seenBefore: Ledger | null, stamp: number): Promise<Ledger | null> => {
  const cwd = await $.session.cwd()
  let newest: { root: string; path: string; mtimeMs: number } | null = null
  for (const projectRoot of await projectRoots($, cwd)) {
    const root = join(projectRoot, '.superpowers/sdd')
    const dirs = await $.fs.list(root).catch(() => [])
    for (const entry of dirs) {
      if (entry.kind !== 'dir') continue
      const path = `${root}/${entry.name}/progress.md`
      const stat = await $.fs.stat(path).catch(() => undefined)
      if (stat?.kind === 'file' && (newest === null || stat.mtimeMs > newest.mtimeMs)) newest = { root: projectRoot, path, mtimeMs: stat.mtimeMs }
    }
  }
  if (newest === null) return null
  const text = await $.fs.read(newest.path).catch(() => null)
  if (typeof text !== 'string') return null
  const lines = text.split('\n')
  const planPath = LEDGER_HEADER.exec(lines[0] ?? '')?.[1]
  if (!planPath) return null
  const planText = await $.fs.read(join(newest.root, planPath)).catch(() => null)
  if (typeof planText !== 'string') return null
  const planLines = planText.split('\n')
  const done = new Set(lines.map(l => LEDGER_DONE.exec(l)?.[1]).filter((id): id is string => id !== undefined))
  const items = planLines
    .map(l => PLAN_TASK.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ id: m[1]!, title: m[2]!, done: done.has(m[1]!) }))
  if (items.length === 0) return null
  const title = (planLines.find(l => l.startsWith('# ')) ?? '# Plano').slice(2).trim()
  const seenAt = seenBefore !== null && seenBefore.planPath === planPath ? seenBefore.seenAt : stamp
  return { planPath, title, tasks: items, updatedAt: newest.mtimeMs, seenAt }
}

let lastLedgerCheck = Number.NEGATIVE_INFINITY
let cachedLedger: Ledger | null = null

/**
 * Relê o ledger (no máximo a cada LEDGER_REFRESH, salvo `force`) e devolve o valor atual.
 * Só grava o atom quando `publish`: escrever estado durante o desenho não vale.
 */
const refreshLedger = async ($: EngineInterface, { force = false, publish = false } = {}): Promise<Ledger | null> => {
  const stamp = await $.clock.now()
  if (!force && stamp - lastLedgerCheck < LEDGER_REFRESH) return cachedLedger
  lastLedgerCheck = stamp
  const after = await loadLedger($, cachedLedger, stamp).catch(() => null)
  const changed = JSON.stringify(after) !== JSON.stringify(cachedLedger)
  cachedLedger = after
  if (changed && publish) await update($, ledger, () => after)
  return after
}

const isLedgerShown = (l: Ledger | null, stamp: number): l is Ledger =>
  l !== null && (l.tasks.some(t => !t.done) || stamp - l.updatedAt < LEDGER_DONE_TTL)

const fromLedger = (l: Ledger): Todo[] => {
  const current = l.tasks.find(t => !t.done)
  return l.tasks.map(t => ({
    content: `Task ${t.id}: ${t.title}`,
    activeForm: `Task ${t.id}: ${t.title}`,
    status: t.done ? 'completed' : t === current ? 'in_progress' : 'pending',
  }))
}

const fromTasks = (list: readonly TrackedTask[]): Todo[] =>
  list.map(t => ({ content: t.subject, activeForm: t.activeForm, status: t.status }))

// O painel abre sozinho quando um plano ganha itens. Um plano só abre uma vez: se você fechar, ele fica fechado até você abrir.
let announced: number | string | null = null
async function openPlanPane($: EngineInterface) {
  if (off) return
  const key = (await read($, plan))?.startedAt ?? 'tasks'
  if (announced === key) return
  announced = key
  try {
    await $.ui.open({ id: PANE, title: TITLE })
  } catch {
    // Sem painel disponível o plano segue invisível até /subagentes.
  }
}

export const register: Register = on => {
  lastLedgerCheck = Number.NEGATIVE_INFINITY
  cachedLedger = null
  registerSubagents(on, () => off)

  on('session.start', async ($, e, next) => {
    await update($, now, () => 0)
    await refreshLedger($, { force: true, publish: true }).catch(() => undefined)
    await readSwitch($).catch(() => undefined)
    await startSubagents($, () => off)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    $.clock.every(5000, async () => {
      const current = await refreshLedger($, { publish: true }).catch(() => null)
      const shown = isLedgerShown(current, await $.clock.now())
      if (shown || isActive(await read($, plan)) || (await read($, tasks)).some(t => t.status !== 'completed')) {
        const stamp = await $.clock.now()
        await update($, now, () => stamp)
      }
    })
    return next(e)
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
    if (e.tool === 'Bash') await refreshLedger($, { force: true, publish: true }).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // O plano fica no painel de subagentes (um banner acima do prompt conflitava com a faixa do cache).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (off) return next(e)
    // O atom só serve para redesenhar quem lê; o valor vem da leitura (com cache).
    await read($, ledger)
    const sdd = await refreshLedger($).catch(() => null)
    const stamp = await $.clock.now()
    const current = await read($, plan)
    const tracked = await read($, tasks)

    const source = isLedgerShown(sdd, stamp)
      ? { goal: sdd.title, items: fromLedger(sdd), startedAt: sdd.seenAt }
      : current !== null && current.todos.length > 0
        ? { goal: current.goal, items: current.todos, startedAt: current.startedAt }
        : tracked.length > 0
          ? { goal: current?.goal ?? 'Sessão atual', items: fromTasks(tracked), startedAt: current?.startedAt ?? stamp }
          : null
    if (source === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const clock = await read($, now)
    const percent = percentOf(source.items)
    const done = source.items.filter(t => t.status === 'completed').length
    const isDone = done === source.items.length
    const phase = current?.phase
    const below = nestable(await next(e))

    // Linhas no formato do To-do do chat-inventory: a marca numa coluna fixa e o texto ao lado.
    const todoRow = (t: Todo, i: number) => {
      const finished = t.status === 'completed'
      const live = t.status === 'in_progress'
      return (
        <Box key={`todo-${i}`} flexDirection="row">
          <Box width={2} flexShrink={0}>
            {finished ? <Text color="#16a34a">✓</Text> : live ? <Text color="#d97757">●</Text> : <Text dimColor>○</Text>}
          </Box>
          <Text dimColor={finished} strikethrough={finished} bold={live}>
            {live ? t.activeForm : t.content}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>Plano: </Text>
          <Text>{clip(source.goal, 70)}</Text>
        </Text>
        {phase !== undefined && <Text dimColor>Fase: {phase}</Text>}
        <Text color={isDone ? 'success' : undefined}>
          {bar(percent)} {percent}% ({done}/{source.items.length})  {elapsed(Math.max(clock, stamp, source.startedAt) - source.startedAt)}
        </Text>
        {source.items.map(todoRow)}
        {below as never}
      </Box>
    )
  })
}
