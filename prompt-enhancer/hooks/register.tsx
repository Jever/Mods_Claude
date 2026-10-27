import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { findHome } from './home'

const isBusy = atom({ plugin: 'prompt-enhancer', key: 'isBusy' } as const, false)

// O switchboard /mods desliga o mod em todos os chats pelo switches.json.
const NAME = 'prompt-enhancer'
let off = false
// A pasta home, lida no session.start.
let home = ''

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

const MAX_CONTEXT_CHARS = 4000

const SYSTEM = `Você reescreve rascunhos de prompt para um assistente de código (Claude Code).
Responda SOMENTE com o prompt reescrito, em português do Brasil, sem comentários antes ou depois.
O prompt reescrito deve ter estas seções, nesta ordem:
1. Tarefa: o pedido do rascunho, claro e sem ambiguidade.
2. Skills sugeridas: cite pelo nome apenas skills da lista fornecida que se encaixem de fato na tarefa. Omita a seção se nenhuma servir.
3. Contexto do projeto: detalhes relevantes do projeto atual vindos do contexto fornecido. Não invente nada que não esteja nele.
4. Decisões a confirmar comigo antes de começar: as decisões-chave que o assistente deve me perguntar antes de agir.
5. Resultado final esperado: como deve ser o resultado entregue e como verificar que está pronto.
Não use travessões longos. Preserve a intenção do rascunho e não adicione escopo novo.`

const readProjectContext = async ($: EngineInterface): Promise<string> => {
  const cwd = await $.session.cwd()
  const parts = [`Diretório: ${cwd}`]
  for (const name of ['CLAUDE.md', 'README.md']) {
    try {
      const text = await $.fs.read(`${cwd}/${name}`)
      parts.push(`--- ${name} ---\n${text.slice(0, MAX_CONTEXT_CHARS)}`)
    } catch {
      // arquivo ausente: segue sem ele
    }
  }
  return parts.join('\n\n')
}

const readSkills = async ($: EngineInterface): Promise<string> => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const names = (usage.context.breakdown?.skills?.skillFrontmatter ?? []).map(s => s.name)
  const commands = await $.command.list()
  const described = commands.filter(c => names.includes(c.name))
  const withDescription = new Set(described.map(c => c.name))
  return [
    ...described.map(c => `- ${c.name}: ${c.description}`),
    ...names.filter(n => !withDescription.has(n)).map(n => `- ${n}`),
  ].join('\n')
}

const enhance = async ($: EngineInterface, model: string, draft: string) => {
  if (await read($, isBusy)) return
  const text = draft.trim()
  if (!text) {
    $.ui.toast('Escreva um rascunho na caixa de prompt antes de aprimorar.')
    return
  }
  await update($, isBusy, () => true)
  try {
    const [project, skills] = await Promise.all([readProjectContext($), readSkills($)])
    const result = await $.model.complete({
      model,
      system: SYSTEM,
      maxTokens: 2048,
      prompt: `<rascunho>\n${text}\n</rascunho>\n\n<skills_instaladas>\n${skills || '(nenhuma)'}\n</skills_instaladas>\n\n<projeto>\n${project}\n</projeto>`,
    })
    if (!result.isAnswered) {
      $.ui.toast(`Não foi possível aprimorar (${result.reason}).`)
      return
    }
    const enhanced = result.text.trim()
    const filled = await $.prompt.fill({ text: enhanced, mode: 'replace' })
    if (!filled.isFilled) {
      $.ui.toast('A caixa de prompt não aceitou o texto agora.')
      return
    }
    const copied = await $.ui.copy({ text: enhanced })
    if (!copied.isCopied) {
      $.ui.toast('O texto foi para a caixa, mas não deu para copiá-lo.')
      return
    }
    $.ui.toast('Prompt aprimorado e copiado.')
  } catch (error) {
    $.ui.toast(`Falha ao aprimorar: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, isBusy, () => false)
  }
}

export const register: Register = (on, options) => {
  const model = typeof options?.model === 'string' && options.model ? options.model : 'sonnet'

  on('session.start', async ($, e, next) => {
    home = await findHome($)
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    await $.command.register({
      name: 'aprimorar',
      description: 'Reescreve o rascunho do prompt (sem enviar). Aceita o rascunho como argumento.',
      argumentHint: '[rascunho]',
    })
    return next(e)
  })

  on('command.run', { command: 'aprimorar' }, async ($, e) => {
    if (off) return { text: 'O Prompt Enhancer está desligado. Ligue no /mods.' }
    const draft = e.args.trim() || (await $.prompt.read()).text
    void enhance($, model, draft)
    return { text: 'Aprimorando o prompt, o resultado vai para a caixa de prompt e para a área de transferência.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = await read($, isBusy)
    const below = await next(e)

    return (
      <Box>
        {below}
        <Button
          key="enhance"
          label={busy ? 'Aprimorando...' : 'Aprimorar'}
          hotkey="a"
          onPress={async () => enhance($, model, (await $.prompt.read()).text)}
        />
        <Text> </Text>
      </Box>
    )
  })
}
