import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`faixa fica ao lado da de baixo e mostra só o Limpar Sessão (${surface})`, async ($, on) => {
    mock.store(on, {})
    on('ui.render', ($, e) => {
      const { Button } = $.ui.resolve(e)
      return <Button key="base" label="base" onPress={() => {}} />
    })
    const ui = await $.ui.mount({
      plugin: 'cache-keeper',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false },
    })
    expect(await ui.find({ key: 'base' })).toBeTruthy()
    expect(await ui.find({ key: 'handoff' })).toBeTruthy()
    expect(await ui.find({ key: 'fresh' })).toBeFalsy()
    await ui.unmount()
  })
}

test('autohandoff grava e lê o limite', async ($, on) => {
  mock.store(on, {})
  const set = await $.command.run({ command: 'autohandoff', args: '75' })
  expect(set.text).toContain('75%')
  const read = await $.command.run({ command: 'autohandoff', args: '' })
  expect(read.text).toContain('75%')
  const off = await $.command.run({ command: 'autohandoff', args: 'off' })
  expect(off.text).toContain('desligado')
})

// Depois de uma resposta a contagem aparece; depois de 5 min o cache esfria e Manter aquecido segue na faixa.
for (const surface of ['desktop', 'terminal'] as const) {
  test(`conta até o cache esfriar e oferece Manter aquecido (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const files: Record<string, string> = {}
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path in files }) as never)
    on('fs.read', async ($, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('fs.write', async ($, e) => {
      const { path, text } = e as { path: string; text: string }
      files[path] = text
      return { value: undefined } as never
    })
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 100 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)

    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    await clock.advance(30_000)
    let v = await $.ui.mount({ plugin: 'cache-keeper', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Cache\ aquecido/ }), 'countdown with time left').toBeDefined()
    expect(await v.find({ text: /4:30/ }), '4:30 left after 30 s of a 5 min cache').toBeDefined()
    expect(await v.find({ key: 'keepwarm' }), 'keep warm offered').toBeDefined()
    expect(await v.find({ key: 'handoff' }), 'Limpar Sessão still there').toBeDefined()

    await clock.advance(5 * 60_000)
    v = await $.ui.mount({ plugin: 'cache-keeper', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: /Frio há menos de 1 min/ }), 'cold just after 5 min').toBeDefined()
    expect(await v.find({ key: 'handoff' }), 'Limpar Sessão on a cold chat').toBeDefined()
  })
}

// Desligado no /mods, o mod não desenha nada próprio: a faixa de outros mods segue.
for (const surface of ['desktop', 'terminal'] as const) {
  test(`não desenha nada próprio quando desligado no /mods (${surface})`, { timeoutMs: 30000 }, async ($, on) => {
    const switches = '{"cache-keeper": false}'
    const isSwitches = (e: unknown) => (e as { path: string }).path.endsWith('/.claude/mods/switches.json')
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('turn.start', async () => ({}) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.id', async () => ({ value: 'sid' }) as never)
    on('session.usage', async () => ({ value: { context: { tokens: 182_000, window: 1_000_000 } } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '5m\n', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => ({ value: isSwitches(e) }) as never)
    on('fs.read', async ($, e) => ({ value: isSwitches(e) ? switches : '' }) as never)
    on('fs.write', async () => ({ value: undefined }) as never)
    on('store.get', async () => ({ value: undefined }) as never)
    on('store.set', async () => ({ value: undefined }) as never)
    on('turn.complete', async () => ({ text: '' }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>REST</Text>
    })
    const props = { isWorking: false, hasSurvey: false, maxRows: 10, bodyColumns: 100 } as never
    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.turn.complete({ answer: '' } as never)
    await clock.settle()
    const v = await $.ui.mount({ plugin: 'cache-keeper', surface, component: 'AbovePrompt', props })
    expect(await v.find({ text: 'REST' }), 'other bands still draw').toBeDefined()
    expect(await v.find({ key: 'handoff' }), 'no Limpar Sessão while off').toBeUndefined()
    expect(await v.find({ key: 'keepwarm' }), 'no keep warm while off').toBeUndefined()
  })
}
