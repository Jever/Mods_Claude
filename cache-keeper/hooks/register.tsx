import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const isBusy = atom({ plugin: 'cache-keeper', key: 'isBusy' } as const, false)

const THRESHOLD_KEY = 'autohandoff'
const BRIEF_KEY = 'lastBrief'

const BRIEF_PROMPT = `Escreva um briefing de handoff desta sessão para que uma sessão nova continue o trabalho sem perder contexto.
Responda SOMENTE com o briefing, em português do Brasil, sem travessões longos, com estas seções:
1. Objetivo: o que está sendo feito e por quê.
2. Estado atual: o que já foi feito e o que está em andamento (arquivos e comandos relevantes).
3. Decisões tomadas e motivos.
4. Pendências: próximos passos em ordem.
5. Riscos e pontos de atenção: erros conhecidos, premissas não confirmadas.
Seja objetivo e concreto. Não invente nada que não esteja na conversa.`

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

export const register: Register = (on, options) => {
  const parsed = Number(options?.warnPercent)
  const warnPercent = Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 60
  let isWarned = false

  on('session.start', async ($, e, next) => {
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
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent ?? 0
    if (percent < warnPercent) {
      isWarned = false
    } else if (!isWarned) {
      isWarned = true
      $.ui.toast(`Contexto em ${Math.round(percent)}%: a qualidade das respostas pode começar a piorar. Considere um handoff.`)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const threshold = await readThreshold($)
    if (threshold > 0) {
      const { context } = await $.session.usage()
      if ((context.percent ?? 0) >= threshold) {
        void handoff($, true)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'colar') return { text: await pasteLast($) }
    void handoff($, true)
    return { text: 'Iniciando o handoff: briefing, limpeza da sessão e colagem.' }
  })

  on('command.run', { command: 'autohandoff' }, async ($, e) => {
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = await read($, isBusy)
    const below = await next(e)

    return (
      <Box>
        {below}
        <Button
          key="handoff"
          label={busy ? 'Gerando...' : 'Limpar Sessão'}
          hotkey="h"
          onPress={() => handoff($, true)}
        />
        <Text> </Text>
      </Box>
    )
  })
}
