import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Clock, Warm } from '../types'

const isBusy = atom({ plugin: 'cache-keeper', key: 'isBusy' } as const, false)
const CLOCK = { plugin: 'cache-keeper', key: 'clock' } as const
const WARM = { plugin: 'cache-keeper', key: 'warm' } as const

const THRESHOLD_KEY = 'autohandoff'
const BRIEF_KEY = 'lastBrief'

const FIVE_MIN = 5 * 60_000
const ONE_HOUR = 60 * 60_000
const BAR = 20

// Manter aquecido: um ping pequeno cerca de 45 s antes de o cache esfriar.
// $.model.fork repete a última requisição da thread principal (mesmo modelo, prompt
// de sistema, ferramentas e mensagens) com esta linha no fim, então a API lê o chat
// do cache e o timer recomeça. O fork nunca grava no transcript.
const LEAD = 45_000
const MAX_PINGS = 30
const MAX_MS = 2 * 60 * 60_000
const MAX_FAILS = 3
const RETRY_MS = 20_000
const PING_PROMPT = 'Reply with the single word: ok'
// Turnos que não são a pessoa digitando: não contam como "ela voltou".
const BACKGROUND = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation'])

const GOOD = '#16a34a'
const WARN = '#ca8a04'
const BAD = '#dc2626'
const COLD = '#2563eb'

const BRIEF_PROMPT = `Escreva um briefing de handoff desta sessão para que uma sessão nova continue o trabalho sem perder contexto.
Responda SOMENTE com o briefing, em português do Brasil, sem travessões longos, com estas seções:
1. Objetivo: o que está sendo feito e por quê.
2. Estado atual: o que já foi feito e o que está em andamento (arquivos e comandos relevantes).
3. Decisões tomadas e motivos.
4. Pendências: próximos passos em ordem.
5. Riscos e pontos de atenção: erros conhecidos, premissas não confirmadas.
Seja objetivo e concreto. Não invente nada que não esteja na conversa.`

// Module variables reset on a reload; the clock and the warm state live in $.state.
let sid = ''
let home = ''
let detected: 'unknown' | '5m' | '1h' = 'unknown'
let working = false
let pinging = false

// O switchboard /mods desliga o mod em todos os chats pelo switches.json.
const NAME = 'cache-keeper'
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
  if (off) await stopWarm($, 'Manter aquecido parado: o Cache Keeper foi desligado no /mods.')
  await redraw($)
}

async function redraw($: EngineInterface) {
  try {
    const c = await getClock($)
    if (c) await setClock($, { ...c, now: await $.clock.now() })
    $.ui.invalidate('ui.render')
  } catch {
    // O próximo tick redesenha de qualquer forma.
  }
}

const readThreshold = async ($: EngineInterface): Promise<number> => {
  const value = Number(await $.store.get(THRESHOLD_KEY))
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : 0
}

const handoff = async ($: EngineInterface, shouldClear: boolean): Promise<void> => {
  if (await read($, isBusy)) return
  await update($, isBusy, () => true)
  try {
    $.ui.toast('Gerando o briefing de handoff...')
    const result = await $.model.fork({ prompt: BRIEF_PROMPT })
    if (!result.isAnswered) {
      $.ui.toast(
        result.reason === 'nothing-to-fork'
          ? 'Ainda não há conversa para entregar.'
          : `Não foi possível gerar o briefing (${result.reason}).`,
      )
      return
    }
    const brief = result.text.trim()
    await $.store.set(BRIEF_KEY, brief)
    if (shouldClear) await $.command.run({ command: 'clear' })
    const filled = await $.prompt.fill({ text: brief, mode: 'replace' })
    $.ui.toast(
      filled.isFilled
        ? 'Briefing colado na caixa de prompt. Revise e envie.'
        : 'Briefing salvo. Rode /handoff colar para colocá-lo na caixa de prompt.',
    )
  } catch (error) {
    $.ui.toast(`Falha no handoff: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, isBusy, () => false)
  }
}

const pasteLast = async ($: EngineInterface): Promise<string> => {
  const brief = await $.store.get(BRIEF_KEY)
  if (typeof brief !== 'string' || !brief) return 'Nenhum briefing salvo ainda.'
  const filled = await $.prompt.fill({ text: brief, mode: 'replace' })
  return filled.isFilled ? 'Briefing colado na caixa de prompt.' : 'A caixa de prompt não aceitou o texto agora.'
}

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// De onde vem o tamanho do cache: a resposta da Anthropic ou uma estimativa antes da primeira.
function lengthLabel(c: Clock) {
  if (c.ttlSource === 'detected') return `cache de ${c.ttlMs === ONE_HOUR ? '1 h' : '5 min'}, conforme a última resposta da Anthropic`
  return 'cache de 5 min, uma estimativa até a primeira resposta'
}

function ttl(): { ttlMs: number; ttlSource: Clock['ttlSource'] } {
  if (detected === '1h') return { ttlMs: ONE_HOUR, ttlSource: 'detected' }
  if (detected === '5m') return { ttlMs: FIVE_MIN, ttlSource: 'detected' }
  return { ttlMs: FIVE_MIN, ttlSource: 'default' }
}

async function getClock($: EngineInterface): Promise<Clock | null> {
  const { value } = await $.state.get(CLOCK)
  return value ?? null
}

async function setClock($: EngineInterface, c: Clock | null) {
  await $.state.set(CLOCK, c)
}

async function getWarm($: EngineInterface): Promise<Warm | null> {
  const { value } = await $.state.get(WARM)
  return value ?? null
}

async function setWarm($: EngineInterface, w: Warm | null) {
  await $.state.set(WARM, w)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // O próximo tick redesenha de qualquer forma.
  }
}

function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text)
  } catch {
    // O aviso é só uma dica.
  }
}

// Liga o manter aquecido. 'none' quando ainda não há resposta cujo cache possa ser mantido.
async function startWarm($: EngineInterface): Promise<'on' | 'none'> {
  const c = await getClock($)
  if (!c || !c.lastEnd) return 'none'
  await setWarm($, { startedAt: await $.clock.now(), pings: 0, read: 0, write: 0, cold: false, error: '', sending: false, failures: 0, retryAt: 0 })
  await log($, `keep warm on (${c.ttlMs / 1000} s cache, ${short(c.tokens)} tokens)`)
  return 'on'
}

async function stopWarm($: EngineInterface, why: string, shout = true) {
  const w = await getWarm($)
  if (!w) return
  await setWarm($, null)
  await log($, `keep warm off after ${w.pings} pings: ${why}`)
  if (shout) toast($, why)
}

async function toggleWarm($: EngineInterface) {
  if (await getWarm($)) return stopWarm($, 'Manter aquecido parado.')
  if ((await startWarm($)) === 'none') toast($, 'Nada para manter aquecido ainda. Funciona depois da primeira resposta do Claude.')
  else toast($, 'Manter aquecido ligado. Digite /keepwarm off para parar.')
}

// Uma vez por segundo: envia o ping quando o cache está a 45 s de esfriar e respeita os limites.
async function warmTick($: EngineInterface) {
  const w = await getWarm($)
  if (!w || pinging || working) return
  if (off) return stopWarm($, 'Manter aquecido parado: o Cache Keeper foi desligado no /mods.')
  const now = await $.clock.now()
  if (now - w.startedAt >= MAX_MS) return stopWarm($, 'Manter aquecido parado após 2 horas. Digite /keepwarm para ligar de novo.')
  if (w.pings >= MAX_PINGS) return stopWarm($, `Manter aquecido parado após ${MAX_PINGS} pings. Digite /keepwarm para ligar de novo.`)
  if (now < w.retryAt) return
  const c = await getClock($)
  if (!c || !c.lastEnd) return
  if (c.lastEnd + c.ttlMs - now > LEAD) return
  pinging = true
  void ping($, now).catch(async err => {
    pinging = false
    await log($, `ping failed: ${String(err)}`)
  })
}

async function ping($: EngineInterface, start: number) {
  const w0 = await getWarm($)
  if (w0) await setWarm($, { ...w0, sending: true })
  let r: ModelForkResult | null = null
  let thrown = ''
  try {
    r = await $.model.fork({ prompt: PING_PROMPT })
  } catch (err) {
    thrown = String(err)
  }
  pinging = false
  const n = (w0?.pings ?? 0) + 1
  if (r && !r.isAnswered && r.reason === 'nothing-to-fork') {
    await log($, `ping ${n}: nothing to fork yet`)
    return stopWarm($, 'Manter aquecido parado: ainda não há resposta para manter aquecida.')
  }
  const usage = r && 'usage' in r ? r.usage : null
  const read = usage?.cache_read_input_tokens ?? 0
  const write = usage?.cache_creation_input_tokens ?? 0
  // Uma resposta, ou uma sem palavras, ainda leu o chat: o timer do cache recomeçou.
  const ok = r !== null && (r.isAnswered || r.reason === 'empty-reply')
  const error = ok ? '' : thrown ? 'error' : r && !r.isAnswered && r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r && !r.isAnswered ? r.reason : 'error'
  await log($, `ping ${n}: cache read ${read}, cache write ${write}, error ${error || 'none'}${thrown ? ` (${thrown.slice(0, 200)})` : ''}`)
  const w = await getWarm($)
  // Parado enquanto o ping estava fora (um prompt, /keepwarm off): só o log guarda isso.
  if (!w) return
  const now = await $.clock.now()
  if (ok) {
    await setWarm($, { ...w, pings: n, read, write, cold: write > read, error: '', sending: false, failures: 0, retryAt: 0 })
    const c = await getClock($)
    if (c) await setClock($, { ...c, lastEnd: Math.max(c.lastEnd, start), now })
  } else {
    const failures = w.failures + 1
    await setWarm($, { ...w, pings: n, error, sending: false, failures, retryAt: now + RETRY_MS })
    if (failures >= MAX_FAILS) return stopWarm($, `Manter aquecido parado: ${MAX_FAILS} pings seguidos falharam (${error}).`)
  }
  if (n >= MAX_PINGS) await stopWarm($, `Manter aquecido parado após ${MAX_PINGS} pings. Digite /keepwarm para ligar de novo.`)
}

function warmLine(w: Warm, left: number): string {
  const parts = ['Mantendo aquecido']
  if (w.sending) parts.push(`enviando ping ${w.pings + 1}`)
  else if (w.pings === 0) parts.push(`primeiro ping em ${mmss(left - LEAD)}`)
  else parts.push(`ping ${w.pings}`, `próximo em ${mmss(left - LEAD)}`)
  if (w.error) parts.push(`último ping falhou (${w.error}), tentando de novo`)
  else if (w.pings > 0 && w.cold) parts.push(`o cache tinha esfriado, então o ping ${w.pings} escreveu ${short(w.write)} tokens de novo`)
  else if (w.pings > 0) parts.push(`o último ping leu ${short(w.read)} tokens do cache`)
  return parts.join(' · ')
}

async function log($: EngineInterface, line: string) {
  try {
    const path = `${home}/.claude/mods-logs/cache-keeper.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const lines = old ? old.trimEnd().split('\n').slice(-200) : []
    lines.push(`${new Date(await $.clock.now()).toISOString()} ${sid.slice(0, 8)} ${line}`)
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch {
    // O log nunca quebra o mod.
  }
}

// Lê com qual duração de cache as respostas deste chat foram gravadas (5 min ou 1 h).
async function detect($: EngineInterface) {
  if (!sid) return
  const r = await $.process.run(['python3', `${$.plugin.root}/bin/ttl.py`, sid])
  const out = r.stdout.trim()
  if (out === '5m' || out === '1h') detected = out
  else if (r.exitCode !== 0) await log($, `ttl check failed: ${r.stderr.slice(0, 200)}`)
}

// Uma resposta da thread principal acabou de terminar: o cache está quente de novo a partir de agora.
async function restart($: EngineInterface) {
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  await detect($).catch(() => undefined)
  await setClock($, { lastEnd: now, ...ttl(), tokens: context.tokens ?? 0, now })
}

// Uma vez por segundo: move a contagem enquanto a faixa aparece.
async function tick($: EngineInterface) {
  const c = await getClock($)
  if (!c || off || !c.lastEnd) return
  const now = await $.clock.now()
  // Um cache frio só precisa de redesenho uma vez por minuto, para a linha "esfriou".
  const cold = now - c.lastEnd >= c.ttlMs
  if (cold && Math.floor((now - c.lastEnd) / 60_000) === Math.floor((c.now - c.lastEnd) / 60_000)) return
  await setClock($, { ...c, now })
}

export const register: Register = (on, options) => {
  const parsed = Number(options?.warnPercent)
  const warnPercent = Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 60
  let isWarned = false

  on('session.start', async ($, e, next) => {
    sid = await $.session.id()
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    await $.command.register({
      name: 'handoff',
      description: 'Gera o briefing de handoff, limpa a sessão e cola o briefing. "colar" recola o último.',
      argumentHint: '[agora|colar]',
    })
    await $.command.register({
      name: 'autohandoff',
      description: 'Define o limite de contexto (%) para o handoff automático. "off" desliga.',
      argumentHint: '[percentual|off]',
    })
    await $.command.register({
      name: 'keepwarm',
      description: 'Mantém o cache aquecido com um ping pequeno 45 s antes de esfriar. "/keepwarm off" para parar.',
      argumentHint: '[off]',
      immediate: true,
    })
    $.clock.every(1000, () => {
      void tick($).catch(() => undefined)
      void warmTick($).catch(err => log($, `keep warm tick failed: ${String(err)}`))
    })
    void detect($).catch(() => undefined)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent ?? 0
    if (percent < warnPercent) {
      isWarned = false
    } else if (!isWarned) {
      isWarned = true
      if (!off) $.ui.toast(`Contexto em ${Math.round(percent)}%: a qualidade das respostas pode começar a piorar. Considere um handoff.`)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // Se o engine abrir um turno para o próprio ping, ele não é turno da pessoa.
    if (!off && !(pinging && e.text === PING_PROMPT)) working = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (off) return next(e)
    const result = await next(e)
    // O turno de um helper não mexe no cache da thread principal.
    if (e.agentId === undefined) {
      working = false
      void restart($).catch(err => log($, `restart failed: ${String(err)}`))
    }
    const threshold = await readThreshold($)
    if (threshold > 0) {
      const { context } = await $.session.usage()
      if ((context.percent ?? 0) >= threshold) void handoff($, true)
    }
    return result
  })

  // A pessoa voltou: um prompt dela encerra o manter aquecido. Os comandos do próprio mod não.
  on('prompt.submit', async ($, e, next) => {
    if (off) return next(e)
    const text = e.text.trim().toLowerCase()
    const own = text.startsWith('/keepwarm') || text === PING_PROMPT.toLowerCase()
    if (!own && !BACKGROUND.has(e.origin?.kind ?? '')) {
      void stopWarm($, 'Manter aquecido parado: você enviou uma mensagem.').catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (off) return { text: 'O Cache Keeper está desligado. Ligue no /mods.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'colar') return { text: await pasteLast($) }
    void handoff($, true)
    return { text: 'Iniciando o handoff: briefing, limpeza da sessão e colagem.' }
  })

  on('command.run', { command: 'autohandoff' }, async ($, e) => {
    if (off) return { text: 'O Cache Keeper está desligado. Ligue no /mods.' }
    const arg = e.args.trim().toLowerCase()
    if (!arg) {
      const current = await readThreshold($)
      return { text: current ? `Handoff automático em ${current}% de contexto.` : 'Handoff automático desligado.' }
    }
    if (arg === 'off') {
      await $.store.set(THRESHOLD_KEY, 0)
      return { text: 'Handoff automático desligado.' }
    }
    const value = Number(arg.replace('%', ''))
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      return { text: 'Use um percentual entre 1 e 100, ou "off".' }
    }
    await $.store.set(THRESHOLD_KEY, value)
    return { text: `Handoff automático ligado em ${value}% de contexto.` }
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    if (off) return { text: 'O Cache Keeper está desligado. Ligue no /mods.' }
    const arg = e.args.trim().toLowerCase()
    const w = await getWarm($)
    if (arg === 'off' || (arg !== 'on' && w)) {
      await stopWarm($, 'Manter aquecido parado.', false)
      return { text: 'Manter aquecido parado. Digite /keepwarm para ligar de novo.' }
    }
    if (w) return { text: 'Manter aquecido já está ligado. Digite /keepwarm off para parar.' }
    if ((await startWarm($)) === 'none') return { text: 'Nada para manter aquecido ainda. Funciona depois da primeira resposta do Claude.' }
    return { text: 'Manter aquecido ligado: um ping pequeno cerca de 45 s antes de o cache esfriar. Para depois de 2 horas, 30 pings ou quando você enviar uma mensagem. Digite /keepwarm off para parar.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = await read($, isBusy)
    const below = await next(e)
    const c = await getClock($)
    const w = await getWarm($)

    // Sempre duas linhas, com larguras fixas: a contagem, a barra e os textos mudam sem
    // empurrar os botões, e a faixa não pula de lugar enquanto o tempo passa.
    const cols = Math.max(80, e.props.bodyColumns || 0)
    const TIMER_W = 24
    const KEEP_W = 22
    const HANDOFF_W = 18
    const BAR_W = Math.min(BAR, cols - TIMER_W - KEEP_W - HANDOFF_W - 3)

    const turning = working || e.props.isWorking
    const left = c && c.lastEnd ? c.lastEnd + c.ttlMs - c.now : 0
    const cost = c ? `${short(c.tokens)} tokens` : ''
    let timer = '◷ Cache ainda não'
    let timerColor: string | undefined
    let filled = 0
    let note = 'O cache começa depois da primeira resposta do Claude.'
    if (turning) {
      timer = '◷ Respondendo...'
      note = 'A resposta em andamento usa o cache.'
    } else if (c && c.lastEnd && left > 0) {
      const share = left / c.ttlMs
      filled = Math.max(1, Math.round(share * BAR_W))
      timerColor = left <= 60_000 ? BAD : share < 0.5 ? WARN : GOOD
      timer = `◷ Cache aquecido ${mmss(left)}`
      note = `${lengthLabel(c)}. Responder agora relê ${cost} por 5 a 10% do custo.`
    } else if (c && c.lastEnd) {
      timerColor = COLD
      const minutes = Math.floor(-left / 60_000)
      timer = minutes < 1 ? '❄ Frio há menos de 1 min' : `❄ Frio há ${minutes} min`
      note = `Sua próxima mensagem relê ${cost} pelo preço cheio.`
    }
    let noteColor: string | undefined
    if (w && !turning) {
      noteColor = w.cold || w.error ? BAD : COLD
      note = warmLine(w, left)
    }

    const row = (
      <Box flexDirection="row" width={cols} gap={1}>
        <Box width={TIMER_W}>
          <Text color={timerColor} wrap="truncate-end">
            {timer}
          </Text>
        </Box>
        <Box width={BAR_W}>
          <Text>
            <Text color={timerColor}>{'━'.repeat(filled)}</Text>
            <Text dimColor>{'┄'.repeat(BAR_W - filled)}</Text>
          </Text>
        </Box>
        <Box width={KEEP_W}>
          <Button key="keepwarm" label={w ? 'Parar aquecimento' : 'Manter aquecido'} onPress={() => toggleWarm($)} />
        </Box>
        <Box width={HANDOFF_W}>
          <Button key="handoff" label={busy ? 'Gerando...' : 'Limpar Sessão'} hotkey="h" onPress={() => handoff($, true)} />
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" width={cols}>
        {below}
        {row}
        <Box width={cols}>
          {noteColor ? (
            <Text color={noteColor} wrap="truncate-end">
              {note}
            </Text>
          ) : (
            <Text dimColor wrap="truncate-end">
              {note}
            </Text>
          )}
        </Box>
      </Box>
    )
  })
}
