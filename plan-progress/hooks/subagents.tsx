import type { EngineInterface, On } from 'claude-code'

import type { Helper, HelperPhase, Step, StepKind } from '../types'
import { cardBarSvg, CARD_BAR_H } from './cards'
import { connectorName, splitTool } from './connectors'
import { FRAMES, hueOf, HUES, petSvg } from './pets'

// Cards dos subagentes, portados do helper-desk. O painel abre sozinho quando um
// novo grupo de subagentes começa; /subagentes abre quando você quiser.

const NAME = 'plan-progress'
export const PANE = 'subagents'
export const TITLE = 'Subagentes'
const HELPERS = { plugin: 'plan-progress', key: 'helpers' } as const
const CLOCK = { plugin: 'plan-progress', key: 'helperClock' } as const
const VIEW = { plugin: 'plan-progress', key: 'helperView' } as const
const COST = { plugin: 'plan-progress', key: 'helperCost' } as const

const TICK_MS = 300
const POLL_MS = 2000
const HISTORY = 3
const MAX_STEPS = 200
const TAG_W = 11
// Colunas que o bichinho ocupa ao lado do card; o SVG tem 48 por 36 pixels CSS.
const PET_W = 8
const PET_PX_W = 48
const PET_PX_H = 36
// Um bichinho em execução troca de quadro a cada duas batidas do relógio, cerca de 600 ms.
const FRAME_TICKS = 2

const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'
const WARN = '#eab308'
const INK = '#1c1917'
// Quartos de círculo se leem bem em fontes de desktop e no terminal.
const SPIN = ['◐', '◓', '◑', '◒']
const PULSE = ['●∙∙', '∙●∙', '∙∙●', '∙●∙']

const KIND_COLOR: Record<StepKind, string> = {
  Command: '#ca8a04',
  Connector: '#2563eb',
  'File read': '#16a34a',
  'File write': '#d97757',
  Skill: '#9333ea',
  Web: '#0891b2',
  Subagent: '#db2777',
  Tool: '#78716c',
}
const KIND_LABEL: Record<StepKind, string> = {
  Command: 'Comando',
  Connector: 'Conector',
  'File read': 'Leitura',
  'File write': 'Escrita',
  Skill: 'Skill',
  Web: 'Web',
  Subagent: 'Subagente',
  Tool: 'Ferramenta',
}

// ---------- Estado do painel; $.state guarda uma cópia para o painel desenhar ----------

let helpers: Helper[] = []
let seats = 0
// A próxima cor de corpo a entregar, na ordem de HUES.
let nextHue = 0
let tickN = 0
let home = ''
let ticker: { cancel: () => void } | null = null
let poller: { cancel: () => void } | null = null
const strangers = new Set<string>()

function toolWords(tool: string, connector: string) {
  const words = tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
  // "slack_search_public" vindo do Slack vira "Slack · search public".
  if (words.length > 1 && words[0] === connector.split(' ')[0]!.toLowerCase()) words.shift()
  return words.join(' ')
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()

function folder(p: string) {
  const parts = p.split('/')
  parts.pop()
  const dir = parts.join('/')
  return home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir
}

/** Uma chamada de ferramenta: o tipo, um rótulo curto para a lista e palavras simples para a linha ao vivo. */
function describe(tool: string, args: Record<string, unknown>): Step {
  const s = (k: string) => (typeof args[k] === 'string' ? oneLine(args[k] as string) : '')
  const file = (verb: string, kind: StepKind, key = 'file_path'): Step => {
    const p = typeof args[key] === 'string' ? (args[key] as string) : ''
    const name = base(p) || 'um arquivo'
    return { kind, label: name, dim: p ? folder(p) : '', live: `${verb} ${name}` }
  }
  if (tool.startsWith('mcp__')) {
    const { server, name: toolName } = splitTool(tool)
    const name = connectorName(server, toolName)
    const words = toolWords(toolName.replace(/__/g, '_'), name)
    return { kind: 'Connector', label: `${name} · ${words}`, dim: '', live: `${name}: ${words}` }
  }
  switch (tool) {
    case 'Read':
      return file('Lendo', 'File read')
    case 'Write':
      return file('Escrevendo', 'File write')
    case 'Edit':
    case 'MultiEdit':
      return file('Editando', 'File write')
    case 'NotebookEdit':
      return file('Editando', 'File write', 'notebook_path')
    case 'Grep':
    case 'Glob': {
      const pat = s('pattern')
      const p = s('path')
      return {
        kind: 'File read',
        label: pat ? `Busca "${cut(pat, 60)}"` : 'Buscar arquivos',
        dim: p ? (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p) : '',
        live: pat ? `Buscando "${cut(pat, 40)}" nos arquivos` : 'Buscando arquivos',
      }
    }
    case 'Bash': {
      const label = s('description') || cut(s('command'), 80) || 'um comando'
      return { kind: 'Command', label, dim: '', live: `Executando: ${label}` }
    }
    case 'WebSearch':
      return { kind: 'Web', label: s('query') || 'busca na web', dim: '', live: `Pesquisando na web: ${s('query')}` }
    case 'WebFetch': {
      let host = 'uma página'
      try {
        host = new URL(s('url')).host
      } catch {
        // Não é URL: fica com as palavras simples.
      }
      return { kind: 'Web', label: host, dim: '', live: `Abrindo ${host}` }
    }
    case 'Skill':
      return { kind: 'Skill', label: s('skill') || 'uma skill', dim: '', live: `Usando a skill ${s('skill') || ''}`.trim() }
    case 'Agent':
    case 'Task':
      return {
        kind: 'Subagent',
        label: s('description') || 'Iniciar um subagente',
        dim: '',
        live: s('description') ? `Iniciando um subagente: ${s('description')}` : 'Iniciando um subagente',
      }
    case 'SendMessage':
      return { kind: 'Subagent', label: 'Enviar mensagem', dim: '', live: 'Enviando mensagem' }
    case 'TodoWrite':
      return { kind: 'Tool', label: 'Atualizar a lista de tarefas', dim: '', live: 'Atualizando a lista de tarefas' }
    case 'ToolSearch':
      return { kind: 'Tool', label: 'Carregar ferramentas', dim: '', live: 'Carregando ferramentas' }
    default:
      return { kind: 'Tool', label: tool, dim: '', live: `Usando ${tool}` }
  }
}

function clockTime(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function tokenText(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** "claude-opus-5-5" vira "Opus 5.5"; "haiku" vira "Haiku". */
function shortModel(model: string) {
  const hit = /(opus|sonnet|haiku|fable)(?:[-_ ](\d+))?(?:[-_.](\d+))?/i.exec(model)
  if (!hit) return model
  const fam = hit[1]![0]!.toUpperCase() + hit[1]!.slice(1).toLowerCase()
  return hit[2] ? `${fam} ${hit[2]}${hit[3] ? `.${hit[3]}` : ''}` : fam
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const usageTotal = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const working = () => helpers.filter(hp => hp.phase === 'working').length

/** A próxima cor, na ordem, que nenhum subagente em execução usa; com as 8 ocupadas, a próxima na ordem. */
function pickHue() {
  const used = new Set(helpers.filter(hp => hp.phase === 'working').map(hp => hp.hue % HUES.length))
  let hue = nextHue % HUES.length
  for (let i = 0; i < HUES.length; i += 1) {
    const h = (nextHue + i) % HUES.length
    if (!used.has(h)) {
      hue = h
      break
    }
  }
  nextHue = hue + 1
  return hue
}
const copy = (hp: Helper): Helper => ({ ...hp, steps: hp.steps.map(st => ({ ...st })) })

async function tick($: EngineInterface) {
  tickN += 1
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
}

async function readCost($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await $.state.set(COST, { usd: typeof u.cost?.usd === 'number' ? u.cost.usd : null })
  } catch {
    // Sem livro-razão de custo: o card de custo fica escondido.
  }
}

async function poll($: EngineInterface, isOff: () => boolean) {
  if (!working() || isOff()) return
  const list = await $.agent.list()
  const now = await $.clock.now()
  let changed = false
  for (const a of list) {
    const hp = helpers.find(x => x.id === a.id)
    if (!hp || hp.phase !== 'working') continue
    // A lista pode atrasar um fim de turno; ela só tira um card de "em execução".
    const next: HelperPhase | null =
      a.status === 'completed' || a.status === 'idle' ? 'done' : a.status === 'failed' || a.status === 'killed' ? 'failed' : null
    if (next) {
      hp.phase = next
      hp.endedAt = now
      changed = true
    }
    if (!hp.description && a.description) {
      hp.description = a.description
      changed = true
    }
  }
  if (changed) await publish($, isOff)
  else await readCost($)
}

function syncTimers($: EngineInterface, isOff: () => boolean) {
  if (working() && !isOff()) {
    ticker ??= $.clock.every(TICK_MS, () => {
      if (!isOff()) void tick($).catch(() => undefined)
    })
    poller ??= $.clock.every(POLL_MS, () => {
      void poll($, isOff).catch(() => undefined)
    })
  } else {
    ticker?.cancel()
    poller?.cancel()
    ticker = null
    poller = null
  }
}

async function publish($: EngineInterface, isOff: () => boolean) {
  await $.state.set(HELPERS, helpers.map(copy))
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
  await readCost($)
  syncTimers($, isOff)
}

async function addHelper($: EngineInterface, isOff: () => boolean, id: string, description: string, type: string, model: string) {
  const known = helpers.find(hp => hp.id === id)
  if (known) {
    // Visto primeiro pelas próprias chamadas: completa com o que o spawn sabe.
    if (description) known.description = description
    if (type) known.type = type
    if (model && !known.model) known.model = model
    await publish($, isOff)
    return
  }
  const wasIdle = working() === 0
  const now = await $.clock.now()
  helpers.push({
    id,
    description: description || 'Subagente',
    type: type || 'subagente',
    model,
    effort: '',
    phase: 'working',
    startedAt: now,
    endedAt: 0,
    count: 0,
    steps: [],
    tokens: 0,
    turnTokens: 0,
    hasUsage: false,
    seat: seats,
    hue: pickHue(),
  })
  seats += 1
  await publish($, isOff)
  // O painel abre sozinho quando um novo grupo de subagentes começa.
  if (wasIdle && !isOff()) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

/** Um laço cujo spawn este mod não viu (um reload, uma corrida): pega de $.agent.list(). */
async function adopt($: EngineInterface, isOff: () => boolean, id: string) {
  if (helpers.some(hp => hp.id === id) || strangers.has(id)) return
  const a = (await $.agent.list()).find(x => x.id === id)
  if (!a) {
    // Os forks do próprio engine têm ids que nenhuma lista traz: deixa de fora.
    strangers.add(id)
    return
  }
  await addHelper($, isOff, id, a.description, a.type, '')
}

async function noteTool($: EngineInterface, isOff: () => boolean, id: string, step: Step) {
  if (!helpers.some(x => x.id === id)) await adopt($, isOff, id)
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  hp.count += 1
  hp.steps = [...hp.steps, step].slice(-MAX_STEPS)
  // Um colega que terminou um turno e volta a trabalhar está em execução de novo.
  if (hp.phase !== 'working') {
    hp.phase = 'working'
    hp.endedAt = 0
  }
  await publish($, isOff)
}

async function noteStep($: EngineInterface, isOff: () => boolean, id: string, model: string, effort: string, usage: Usage | null) {
  if (!helpers.some(x => x.id === id)) await adopt($, isOff, id)
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  if (model) hp.model = shortModel(model)
  if (effort) hp.effort = effort
  if (usage) {
    hp.turnTokens += usageTotal(usage)
    hp.hasUsage = true
  }
  await publish($, isOff)
}

async function finish($: EngineInterface, isOff: () => boolean, id: string, phase: HelperPhase, usage: Usage | null) {
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  // A soma do turno vale mais que os passos contados até agora.
  hp.tokens += usage ? usageTotal(usage) : hp.turnTokens
  hp.turnTokens = 0
  if (usage) hp.hasUsage = true
  hp.phase = phase
  hp.endedAt = await $.clock.now()
  await publish($, isOff)
}

async function toggleIn($: EngineInterface, field: 'open' | 'folded', id: string) {
  const { value = { open: [], folded: [] } } = await $.state.get(VIEW)
  const list = value[field]
  const nextList = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await $.state.set(VIEW, { ...value, [field]: nextList })
}

// ---------- Desenho ----------

/** Um rótulo e depois o texto apagado, ambos cortados para caber em `w`; a pasta cede primeiro. */
function fitRow(label: string, dim: string, w: number): [string, string] {
  if (label.length >= w || !dim) return [cut(label, w), '']
  const room = w - label.length - 2
  if (room < 4) return [label, '']
  return [label, dim.length > room ? `…${dim.slice(-(room - 1))}` : dim]
}

/** A barra do terminal: uma linha grossa de blocos, cheia quando termina, com um trecho deslizante em execução. */
function barParts(phase: HelperPhase, w: number, tick: number, seat: number): [string, string, string] {
  if (phase !== 'working') return ['', '█'.repeat(w), '']
  const piece = Math.max(3, Math.floor(w / 4))
  const span = w + piece
  const head = ((tick + seat * 5 + piece) % span) - piece
  const from = Math.max(0, head)
  const to = Math.min(w, head + piece)
  return ['░'.repeat(from), '█'.repeat(Math.max(0, to - from)), '░'.repeat(w - Math.max(from, to))]
}

/** Na abertura da sessão: registra o comando e carrega o último painel salvo (um reload segue dele). */
export async function startSubagents($: EngineInterface, isOff: () => boolean) {
  home = $.plugin.root.split('/.claude/')[0] ?? ''
  await $.command.register({ name: 'subagentes', description: 'Abre o painel de subagentes: um card com o andamento de cada um', immediate: true })
  if (!helpers.length) {
    const { value } = await $.state.get(HELPERS)
    if (value?.length) {
      // Uma cópia de antes das cores não tem cor: o lugar dela escolhe uma.
      helpers = value.map(hp => ({ ...copy(hp), hue: typeof hp.hue === 'number' ? hp.hue : hp.seat % HUES.length }))
      seats = Math.max(...helpers.map(hp => hp.seat)) + 1
      nextHue = (Math.max(...helpers.map(hp => hp.hue)) + 1) % HUES.length
      syncTimers($, isOff)
    }
  }
}

/**
 * O que um desenho de baixo devolveu, pronto para ser aninhado. O engine devolve um placeholder
 * próprio quando ninguém desenha; aninhá-lo recusa a árvore inteira e o painel fica vazio.
 */
export const nestable = (drawn: unknown) => (drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null)

/** Chamada de ferramenta de um subagente: o passo entra no card dele. A lógica do plano não muda. */
export function trackSubagentCall($: EngineInterface, isOff: () => boolean, call: { tool: string; agentId?: string }) {
  if (call.agentId && !isOff()) {
    void noteTool($, isOff, call.agentId, describe(call.tool, call as unknown as Record<string, unknown>)).catch(() => undefined)
  }
}

/**
 * Registra os hooks dos subagentes. `isOff` diz se o mod está desligado no /mods; quando está,
 * o painel não desenha nada e nenhum subagente é rastreado.
 */
export function registerSubagents(on: On, isOff: () => boolean) {
  on('command.run', { command: 'subagentes' }, async $ => {
    if (isOff()) return { text: `${TITLE} está desligado. Ligue no /mods.` }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: helpers.length ? `${TITLE} aberto.` : `${TITLE} aberto. Os cards aparecem quando o Claude iniciar um subagente.` }
  })

  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    if (isOff()) return next(e)
    if (e.element.startsWith('steps-')) {
      await toggleIn($, 'open', e.element.slice('steps-'.length))
      return { element: e.element }
    }
    if (e.element.startsWith('group-')) {
      await toggleIn($, 'folded', e.element.slice('group-'.length))
      return { element: e.element }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (isOff()) return r
    const id = (r as { agentId?: string }).agentId
    if (id) {
      void addHelper($, isOff, id, e.description || 'Subagente', e.subagentType || 'subagente', shortModel(e.model ?? r.model ?? '')).catch(() => undefined)
    }
    return r
  })

  // Cada requisição ao modelo de um subagente: modelo, esforço e contagem de tokens.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const id = e.agentId
    if (id && !isOff()) {
      const effort = e.effort === undefined ? '' : String(e.effort)
      void noteStep($, isOff, id, e.model, effort, r.usage ?? null).catch(() => undefined)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId
    if (id && !isOff() && helpers.some(hp => hp.id === id)) {
      const failed = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
      void finish($, isOff, id, failed ? 'failed' : 'done', e.usage ?? null).catch(() => undefined)
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (isOff()) return next(e)
    // O que vier de dentro (o plano, do plan-progress) fica acima dos cards.
    const below = nestable(await next(e))
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // O Svg desenha no desktop, no editor e no celular; o terminal recebe um glifo.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const { value: list = [] } = await $.state.get(HELPERS)
    const { value: clk = { tick: 0, now: 0 } } = await $.state.get(CLOCK)
    const { value: view = { open: [], folded: [] } } = await $.state.get(VIEW)
    const { value: cost = { usd: null } } = await $.state.get(COST)
    const width = Math.max(32, e.props.bodyColumns)
    // Dentro do card: a borda e o espaçamento tomam 4 colunas, mais o bichinho (PET_W).
    const cw = width - 4 - PET_W

    const running = list.filter(hp => hp.phase === 'working')
    const finished = list.filter(hp => hp.phase === 'done')
    const stopped = list.filter(hp => hp.phase === 'failed')

    // Totais do topo: só números que o engine informou.
    const tiles: { label: string; value: string }[] = []
    if (cost.usd !== null) tiles.push({ label: 'Custo do chat', value: `$${cost.usd.toFixed(2)}` })
    if (list.some(hp => hp.hasUsage)) tiles.push({ label: 'Tokens dos subagentes', value: tokenText(list.reduce((n, hp) => n + hp.tokens + hp.turnTokens, 0)) })
    if (list.length) {
      const start = Math.min(...list.map(hp => hp.startedAt))
      const end = running.length ? Math.max(clk.now, ...running.map(hp => hp.startedAt)) : Math.max(...list.map(hp => hp.endedAt))
      tiles.push({ label: 'Tempo', value: clockTime(end - start) })
    }
    const tileW = tiles.length ? Math.floor((width - (tiles.length - 1)) / tiles.length) : width

    // Um bichinho em execução troca de quadro no relógio; um terminado fica parado.
    const frameOf = (hp: Helper) => (hp.phase === 'working' ? Math.floor(clk.tick / FRAME_TICKS) % FRAMES : 0)

    const pet = (hp: Helper) => {
      const hue = hueOf(hp.hue)
      const frame = frameOf(hp)
      if (Svg) {
        return (
          <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0}>
            <Svg source={petSvg(hp.hue, frame)} alt={`Caranguejo do Claude, ${hue.name}`} width={PET_PX_W} height={PET_PX_H} />
          </Box>
        )
      }
      return (
        <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0} flexDirection="column">
          <Text color={hue.color}>{frame % 2 ? ' ▜█▛' : ' ▟█▙'}</Text>
          <Text color={hue.color}>{frame % 2 ? ' ▘ ▝' : '  ▘▝'}</Text>
        </Box>
      )
    }

    const card = (hp: Helper) => {
      const hue = hueOf(hp.hue)
      const live = hp.phase === 'working'
      const isOpen = view.open.includes(hp.id)
      const mark = live ? '●' : hp.phase === 'done' ? '✓' : '✗'
      const markColor = hp.phase === 'failed' ? BAD : GOOD
      const time = clockTime((live ? Math.max(clk.now, hp.startedAt) : hp.endedAt) - hp.startedAt)
      const meta = [hp.hasUsage ? `${tokenText(hp.tokens + hp.turnTokens)} tokens` : '', time].filter(Boolean).join(' · ')
      const who = [hp.type, hp.model, hp.effort].filter(Boolean).join(' · ')
      const current = hp.steps[hp.steps.length - 1]
      const spin = SPIN[clk.tick % SPIN.length]!
      const pulse = PULSE[clk.tick % PULSE.length]!
      const plural = (n: number) => `passo${n === 1 ? '' : 's'}`
      const lead = live
        ? `Passo ${hp.count} · ${current?.live ?? 'Começando'}`
        : hp.phase === 'done'
          ? `Concluído · ${hp.count} ${plural(hp.count)}`
          : `Interrompido antes de terminar · ${hp.count} ${plural(hp.count)}`
      // Espaço para o giro e o pulso numa linha ao vivo.
      const leadW = Math.max(6, cw - (live ? 2 + pulse.length + 1 : 0))
      const history = (live ? hp.steps.slice(0, -1) : hp.steps).slice(-HISTORY)
      const [b1, b2, b3] = barParts(hp.phase, cw, clk.tick, hp.seat)
      const barColor = hp.phase === 'failed' ? BAD : hue.color
      const rowW = cw - TAG_W
      // Cerca de 6,5 pixels CSS por coluna, como os 48 pixels do bichinho enchem 8 colunas.
      const barPx = Math.max(60, Math.floor(cw * 6.5))

      return (
        <Box
          key={`card-${hp.id}`}
          flexDirection="row"
          width={width}
          marginBottom={1}
          borderStyle="round"
          borderColor={live ? hue.color : undefined}
          borderDimColor={!live}
          paddingX={1}
          paddingY={1}
          gap={0}
        >
          {pet(hp)}
          <Box flexDirection="column" width={cw}>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Box width={cw - 2}>
                <Text bold wrap="truncate-end">
                  {cut(hp.description, cw - 2)}
                </Text>
              </Box>
              <Text bold color={markColor}>{mark}</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Text dimColor wrap="truncate-end">
                {cut(who, Math.max(4, cw - meta.length - 1))}
              </Text>
              <Text dimColor>{meta}</Text>
            </Box>
            <Box flexDirection="row" width={cw} marginTop={1}>
              {live ? <Text bold color={ACCENT}>{`${spin} `}</Text> : null}
              <Box width={leadW}>
                <Text bold={live} color={live ? ACCENT : hp.phase === 'done' ? GOOD : BAD} wrap="truncate-end">
                  {cut(lead, leadW)}
                </Text>
              </Box>
              {live ? <Text color={ACCENT}>{` ${pulse}`}</Text> : null}
            </Box>
            {!isOpen &&
              history.map((st, i) => (
                <Text key={`h-${hp.id}-${i}`} dimColor wrap="truncate-end">
                  {cut(`  ${st.live}`, cw)}
                </Text>
              ))}
            {Svg ? (
              <Box key={`bar-${hp.id}`} width={cw} marginTop={1}>
                <Svg
                  source={cardBarSvg(hp.phase, hue.color, barPx, hp.seat)}
                  alt={live ? 'Trabalhando' : hp.phase === 'done' ? 'Concluído' : 'Interrompido'}
                  width={barPx}
                  height={CARD_BAR_H}
                />
              </Box>
            ) : (
              <Text key={`bar-${hp.id}`} wrap="truncate-end">
                <Text dimColor>{b1}</Text>
                <Text color={barColor}>{b2}</Text>
                <Text dimColor>{b3}</Text>
              </Text>
            )}
            {hp.steps.length ? (
              <Button key={`steps-${hp.id}`} plain dimColor onPress={() => undefined}>
                {isOpen ? '▾ Ocultar passos' : `▸ Todos os ${hp.count} ${plural(hp.count)}`}
              </Button>
            ) : null}
            {isOpen ? (
              <Box key={`list-${hp.id}`} flexDirection="column" width={cw}>
                {hp.count > hp.steps.length ? <Text dimColor>{`${hp.count - hp.steps.length} passos antigos não guardados`}</Text> : null}
                {hp.steps.map((st, i) => {
                  const [label, dim] = fitRow(st.label, st.dim, rowW)
                  return (
                    <Box key={`s-${hp.id}-${i}`} flexDirection="row" width={cw}>
                      <Box width={TAG_W}>
                        <Text color={KIND_COLOR[st.kind]}>{KIND_LABEL[st.kind]}</Text>
                      </Box>
                      <Box width={rowW}>
                        <Text wrap="truncate-end">
                          {label}
                          {dim ? <Text dimColor>{`  ${dim}`}</Text> : null}
                        </Text>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    // Um cabeçalho por grupo: uma barra cheia na largura toda, com o título e a contagem em negrito,
    // e uma seta que recolhe o grupo.
    const group = (id: string, title: string, members: Helper[], fill: string, ink: string) => {
      if (!members.length) return null
      const folded = view.folded.includes(id)
      const label = `${title} · ${members.length}`
      const room = Math.max(label.length, width - 6)
      return (
        <Box key={`grp-${id}`} flexDirection="column" width={width} marginTop={1}>
          <Box key={`head-${id}`} flexDirection="row" width={width} backgroundColor={fill} paddingX={1} marginBottom={1}>
            <Button key={`group-${id}`} plain onPress={() => undefined}>
              <Text bold color={ink} backgroundColor={fill}>
                {folded ? '▸ ' : '▾ '}
              </Text>
            </Button>
            <Text bold color={ink} backgroundColor={fill} wrap="truncate-end">
              {label.padEnd(room)}
            </Text>
          </Box>
          {folded ? null : members.map(card)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        {below as never}
        <Box key="header" flexDirection="row" justifyContent="space-between" gap={1} width={width} marginBottom={1}>
          <Text bold color={running.length ? ACCENT : list.length ? GOOD : undefined}>
            {list.length ? `${list.length} subagente${list.length === 1 ? '' : 's'} neste chat` : 'Nenhum subagente ainda'}
          </Text>
        </Box>
        {tiles.length ? (
          <Box key="tiles" flexDirection="row" gap={1} width={width} marginBottom={1}>
            {tiles.map(t => (
              <Box key={`tile-${t.label}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} width={tileW}>
                <Text dimColor wrap="truncate-end">
                  {t.label}
                </Text>
                <Text bold color={ACCENT} wrap="truncate-end">
                  {t.value}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {list.length ? null : <Text dimColor>Os cards aparecem aqui quando o Claude iniciar um subagente.</Text>}
        {group('running', 'Em execução', running, GOOD, '#ffffff')}
        {group('finished', 'Concluídos', finished, WARN, INK)}
        {group('stopped', 'Interrompidos', stopped, BAD, '#ffffff')}
      </Box>
    )
  })
}
