import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ledger, Phase, Plan, Todo, TodoStatus, TrackedTask } from '../types'
import { planBarSvg } from './cards'
import { homeFrom } from './home'
import { nestable, PANE, registerSubagents, startSubagents, TITLE, trackSubagentCall } from './subagents'

const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)
const now = atom({ plugin: 'plan-progress', key: 'now' } as const, 0)
const tasks = atom({ plugin: 'plan-progress', key: 'tasks' } as const, [])
const ledger = atom({ plugin: 'plan-progress', key: 'ledger' } as const, null)

// O switchboard /mods desliga o mod em todos os chats pelo switches.json.
const NAME = 'plan-progress'
let off = false

const switchesPath = ($: EngineInterface) => `${homeFrom($.plugin.root)}/.claude/mods/switches.json`

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

/** Uma cor entre `a` e `b` (#rrggbb); `t` de 0 a 1. */
const mix = (a: string, b: string, t: number): string => {
  const at = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
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

// Quadro da animação da barra do plano: avança a cada 600 ms enquanto o mod está ligado.
const PLAN_TICK = { plugin: 'plan-progress', key: 'planTick' } as const
const PLAN_TICK_MS = 600
const P_LIGHT = '#c4b5fd'
const P_MID = '#8b5cf6'
const P_DEEP = '#6d28d9'
let sid = ''
let home = ''
let planN = 0

type Source = { goal: string; items: Todo[]; startedAt: number }

/**
 * O plano atual do chat, da fonte mais específica para a mais geral: ledger do superpowers,
 * plano do TodoWrite, lista do TaskCreate. É a única escolha de fonte: o painel e o arquivo
 * compartilhado usam a mesma.
 */
async function currentSource($: EngineInterface): Promise<Source | null> {
  const sdd = await refreshLedger($).catch(() => null)
  const stamp = await $.clock.now()
  const current = await read($, plan)
  const tracked = await read($, tasks)
  return isLedgerShown(sdd, stamp)
    ? { goal: sdd.title, items: fromLedger(sdd), startedAt: sdd.seenAt }
    : current !== null && current.todos.length > 0
      ? { goal: current.goal, items: current.todos, startedAt: current.startedAt }
      : tracked.length > 0
        ? { goal: current?.goal ?? 'Sessão atual', items: fromTasks(tracked), startedAt: current?.startedAt ?? stamp }
        : null
}

// Último conteúdo gravado: o arquivo só é regravado quando o plano muda.
let lastPlanKey = ''

/**
 * Grava o plano do chat em `~/.claude/mods-state/plan-<sessão>.json`, o arquivo que o chat-inventory lê
 * para o To-do. O plan-progress é o escritor: ele já coleta o plano de todas as fontes. Nunca lança.
 */
async function syncPlanFile($: EngineInterface) {
  if (!sid || !home) return
  try {
    const src = await currentSource($)
    if (src === null) return
    const steps = src.items.map(t => ({ text: t.content, status: t.status }))
    const key = JSON.stringify({ title: src.goal, steps })
    if (key === lastPlanKey) return
    lastPlanKey = key
    // O $.fs.write cria as pastas que faltam, em qualquer sistema.
    const updatedAt = new Date(await $.clock.now()).toISOString()
    await $.fs.write(`${home}/.claude/mods-state/plan-${sid}.json`, `${JSON.stringify({ title: src.goal, steps, updatedAt }, null, 2)}\n`)
  } catch {
    // Gravar o arquivo nunca quebra o painel.
  }
}

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
    home = homeFrom($.plugin.root)
    sid = await $.session.id().catch(() => '')
    await update($, now, () => 0)
    $.clock.every(PLAN_TICK_MS, () => {
      planN += 1
      void $.state.set(PLAN_TICK, planN).catch(() => undefined)
    })
    await refreshLedger($, { force: true, publish: true }).catch(() => undefined)
    await readSwitch($).catch(() => undefined)
    await startSubagents($, () => off)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    $.clock.every(5000, async () => {
      void syncPlanFile($)
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
    if (['TodoWrite', 'TaskCreate', 'TaskUpdate'].includes(e.tool)) await syncPlanFile($)
    return result
  }).catch(($, e, next) => next(e))

  // O plano fica no painel de subagentes (um banner acima do prompt conflitava com a faixa do cache).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (off) return next(e)
    // O atom só serve para redesenhar quem lê; o valor vem da leitura (com cache).
    await read($, ledger)
    const stamp = await $.clock.now()
    const source = await currentSource($)
    if (source === null) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // O Svg desenha no desktop, no editor e no celular; o terminal usa blocos.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const width = Math.max(32, e.props.bodyColumns)
    const clock = await read($, now)
    const { value: tick = 0 } = await $.state.get(PLAN_TICK)
    const percent = percentOf(source.items)
    const done = source.items.filter(t => t.status === 'completed').length
    const isDone = done === source.items.length
    const live = source.items.some(t => t.status === 'in_progress')
    const below = nestable(await next(e))
    const time = elapsed(Math.max(clock, stamp, source.startedAt) - source.startedAt)

    // Barra do terminal: degradê de roxo claro a escuro no trecho feito; um bloco que pisca no passo em andamento.
    const barCols = Math.max(10, width - 4 - 24)
    const fillCols = Math.round((barCols * percent) / 100)
    const cells = Array.from({ length: fillCols }, (_, i) => (
      <Text key={`f${i}`} color={mix(P_LIGHT, P_DEEP, fillCols > 1 ? i / (fillCols - 1) : 1)}>
        █
      </Text>
    ))
    const head = live && fillCols < barCols ? <Text color={tick % 2 ? P_MID : P_LIGHT}>▓</Text> : null
    const track = '░'.repeat(Math.max(0, barCols - fillCols - (head ? 1 : 0)))

    // Linhas no formato do To-do do chat-inventory: a marca numa coluna fixa e o texto ao lado.
    const todoRow = (t: Todo, i: number) => {
      const finished = t.status === 'completed'
      const active = t.status === 'in_progress'
      return (
        <Box key={`todo-${i}`} flexDirection="row">
          <Box width={2} flexShrink={0}>
            {finished ? <Text color="#16a34a">✓</Text> : active ? <Text color="#d97757">●</Text> : <Text dimColor>○</Text>}
          </Box>
          <Text dimColor={finished} strikethrough={finished} bold={active}>
            {active ? t.activeForm : t.content}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="column" borderStyle="round" paddingX={1} width={width}>
          <Text wrap="truncate-end">
            <Text bold>Plano: </Text>
            <Text>{clip(source.goal, 70)}</Text>
          </Text>
          <Box flexDirection="row" gap={1}>
            {Svg ? (
              <Svg
                source={planBarSvg(percent, Math.max(120, Math.floor((width - 26) * 6.5)))}
                alt={`Plano: ${percent}%`}
                width={Math.max(120, Math.floor((width - 26) * 6.5))}
                height={14}
              />
            ) : (
              <Text>
                {cells}
                {head}
                <Text dimColor>{track}</Text>
              </Text>
            )}
            <Text color={isDone ? 'success' : undefined} bold>
              {percent}% ({done}/{source.items.length}) {time}
            </Text>
          </Box>
          {source.items.map(todoRow)}
        </Box>
        {below as never}
      </Box>
    )
  })
}
