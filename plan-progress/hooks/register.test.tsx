import type { On, RenderPropsOf } from 'claude-code'
import { test, expect, mock, type Engine } from 'claude-code/testing'

const todos = [
  { content: 'Pesquisar', status: 'completed' as const, activeForm: 'Pesquisando' },
  { content: 'Construir', status: 'in_progress' as const, activeForm: 'Construindo' },
  { content: 'Testar', status: 'pending' as const, activeForm: 'Testando' },
]

// Só hasSurvey importa para o mod; as demais props da faixa ficam com o padrão do kit.
const BAND_PROPS = { hasSurvey: false } as RenderPropsOf['AbovePrompt']
// O plano agora fica no painel de subagentes (requestId 'subagents').
const PANE_PROPS = { title: 'Subagentes', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: {}, view: {} } as never
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', component: 'Pane', requestId: 'subagents', props: PANE_PROPS })

const baseBand = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

/** Projeto sem ledger: a pasta .superpowers/sdd não existe. */
const noLedger = (on: On) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
}

test('sem TodoWrite a faixa não aparece', async ($, on) => {
  mock.clock(on)
  noLedger(on)
  baseBand(on)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'toggle' })).toBeFalsy()
  await ui.unmount()
})

// Os cards: dois subagentes ganham um card cada, um deles lê um arquivo, e depois os dois concluem.
for (const surface of ['desktop', 'terminal'] as const) {
  test(`dois subagentes ganham card, e depois os dois concluem (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const agents: { id: string; description: string; type: string; status: string }[] = []
    const opened: string[] = []
    noLedger(on)
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    on('session.usage', async () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.42 } } }) as never)
    on('fs.exists', async () => ({ value: false }) as never)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('ui.status', async () => ({ value: undefined }) as never)
    on('ui.open', async ($, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    const clock = mock.clock(on, { now: 1_000_000 })
    on('agent.spawn', async ($, e) => {
      const { description, subagentType } = e as { description: string; subagentType: string }
      const id = `agent-${agents.length + 1}`
      agents.push({ id, description, type: subagentType, status: 'running' })
      return { model: 'claude-opus-5-5', agentId: id } as never
    })
    on('agent.list', async () => ({ value: agents.map(a => ({ ...a })) }) as never)
    on('tool.call', async () => ({ result: 'ok' }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    baseBand(on)
    await $.session.start({ source: 'startup', cwd: '/proj', surface, isInteractive: true } as never)

    await $.agent.spawn({ tool_use_id: 's1', prompt: 'x', description: 'Ler as notas', subagentType: 'Explore', model: 'haiku' } as never)
    await $.agent.spawn({ tool_use_id: 's2', prompt: 'x', description: 'Achar as faturas', subagentType: 'general-purpose', model: 'opus' } as never)
    await clock.settle()
    expect(opened, 'pane opened by itself').toContain('subagents')

    // A chamada de ferramenta de um subagente vira passo no card dele.
    const callTool = $.tool.call as unknown as (input: unknown) => Promise<unknown>
    await callTool({ tool: 'Read', tool_use_id: 'c1', file_path: '/proj/notas.md', agentId: 'agent-1' })
    await clock.advance(5_000)

    const props = { title: 'Subagentes', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: {}, view: {} } as never
    const v = await $.ui.mount({ plugin: 'plan-progress', surface, component: 'Pane', requestId: 'subagents', props })
    expect(await v.find({ text: /Ler as notas/ }), 'first description').toBeDefined()
    expect(await v.find({ text: /Achar as faturas/ }), 'second description').toBeDefined()
    expect(await v.find({ text: /Passo 1 · Lendo notas\.md/ }), 'Read in words').toBeDefined()
    expect(await v.find({ key: 'head-running' }), 'running group').toBeDefined()
    expect(await v.find({ text: /\$0\.42/ }), 'chat cost from the engine').toBeDefined()

    agents[0]!.status = 'completed'
    agents[1]!.status = 'completed'
    await clock.advance(2_100)
    expect(await v.find({ key: 'head-finished' }), 'finished group after the poll').toBeDefined()
    expect(await v.find({ key: 'head-running' }), 'running group gone').toBeUndefined()
    await v.unmount()
  })
}

test('desligado no /mods, a faixa não desenha nada próprio', async ($, on) => {
  mock.clock(on)
  noLedger(on)
  const switches = '{"plan-progress": false}'
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path.endsWith('/.claude/mods/switches.json') }) as never)
  on('fs.read', async () => ({ value: switches }) as never)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: todos } }))
  baseBand(on)
  await $.session.start({ source: 'startup', cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'TodoWrite', todos })
  const ui = await mountBand($)
  expect(await ui.find({ key: 'toggle' })).toBeFalsy()
  expect(await ui.find({ text: /base/ })).toBeTruthy()
  await ui.unmount()
})

test('o painel abre uma vez por plano, quando ganha itens', async ($, on) => {
  mock.clock(on)
  noLedger(on)
  const opened: string[] = []
  on('ui.open', async ($, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: todos } }))
  baseBand(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [] })
  expect(opened, 'an empty list opens nothing').toHaveLength(0)
  await $.tool.call({ tool: 'TodoWrite', todos })
  await $.tool.call({ tool: 'TodoWrite', todos })
  expect(opened, 'opens once for the plan').toEqual(['subagents'])
})

test('TodoWrite mostra o progresso e o botão de checklist', async ($, on) => {
  mock.clock(on)
  noLedger(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: todos } }))
  on('ui.render', ($, e) => {
    const { Button } = $.ui.resolve(e)
    return <Button key="base" label="base" onPress={() => {}} />
  })
  await $.tool.call({ tool: 'TodoWrite', todos })
  const ui = await mountBand($)
  expect(await ui.find({ key: 'base' })).toBeTruthy()
  expect(await ui.find({ key: 'toggle' })).toBeTruthy()
  expect(await ui.find({ text: /33% \(1\/3\)/ })).toBeTruthy()
  await ui.unmount()
})

test('TaskCreate e TaskUpdate alimentam o checklist', async ($, on) => {
  mock.clock(on)
  noLedger(on)
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({ result: { task: { id: String(++next), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  baseBand(on)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Construir', description: 'x', activeForm: 'Construindo' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Testar', description: 'y' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  const ui = await mountBand($)
  expect(await ui.find({ text: /0% \(0\/2\)/ })).toBeTruthy()
  expect(await ui.find({ text: /Construindo/ })).toBeTruthy()
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  expect(await ui.find({ text: /100% \(1\/1\)/ })).toBeTruthy()
  await ui.unmount()
})

const PLAN = [
  '# DashCon M9: base visual',
  '',
  '### Task 1: Paleta com cor de destaque',
  'texto',
  '### Task 2: Cabeçalho e menu',
  '### Task 5a: Ícones em painel',
  '### Task 7: Fechamento',
].join('\n')

const LEDGER = [
  '# SDD ledger — plan: docs/superpowers/plans/m9.md',
  'Pre-flight: tudo certo',
  'Task 1: complete (commits a..b, tests: ok)',
  'Task 2: Ruling: algo — motivo — custo',
  'Task 2: complete (commits b..c, tests: ok)',
].join('\n')

test('o ledger do plano mostra tarefas concluídas e a atual', async ($, on) => {
  mock.clock(on, { now: 5000 })
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.list', ($, e) => {
    if (e.path !== '/proj/.superpowers/sdd') throw new Error('ENOENT')
    return { value: [{ name: '2026-10-20-m9', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
  })
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 4000, isLink: false } }))
  on('fs.read', ($, e) => {
    if (e.path === '/proj/.superpowers/sdd/2026-10-20-m9/progress.md') return { value: LEDGER }
    if (e.path === '/proj/docs/superpowers/plans/m9.md') return { value: PLAN }
    throw new Error(`ENOENT ${e.path}`)
  })
  baseBand(on)
  const ui = await mountBand($)
  expect(await ui.find({ text: /DashCon M9: base visual/ })).toBeTruthy()
  expect(await ui.find({ text: /50% \(2\/4\)/ })).toBeTruthy()
  expect(await ui.find({ text: /Task 5a: Ícones em painel/ })).toBeTruthy()
  await ui.unmount()
})

test('ledger antigo e concluído não ocupa a faixa', async ($, on) => {
  mock.clock(on, { now: 60 * 60 * 1000 })
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.list', () => ({ value: [{ name: 'velho', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 0, isLink: false } }))
  on('fs.read', ($, e) => ({
    value: e.path.endsWith('progress.md') ? '# SDD ledger — plan: p.md\nTask 1: complete (x)' : '# Velho\n### Task 1: Única',
  }))
  baseBand(on)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'toggle' })).toBeFalsy()
  await ui.unmount()
})

test('acha o ledger dentro de um worktree do projeto', async ($, on) => {
  mock.clock(on, { now: 5000 })
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.list', ($, e) => {
    if (e.path === '/proj/.worktrees') return { value: [{ name: 'paridade', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
    if (e.path === '/proj/.worktrees/paridade/.superpowers/sdd') return { value: [{ name: 'm9', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 4000, isLink: false } }))
  on('fs.read', ($, e) => {
    if (e.path === '/proj/.worktrees/paridade/.superpowers/sdd/m9/progress.md') return { value: '# SDD ledger — plan: docs/m9.md\nTask 1: complete (x)' }
    if (e.path === '/proj/.worktrees/paridade/docs/m9.md') return { value: '# M9 no worktree\n### Task 1: A\n### Task 2: B' }
    throw new Error(`ENOENT ${e.path}`)
  })
  baseBand(on)
  const ui = await mountBand($)
  expect(await ui.find({ text: /M9 no worktree/ })).toBeTruthy()
  expect(await ui.find({ text: /50% \(1\/2\)/ })).toBeTruthy()
  await ui.unmount()
})
