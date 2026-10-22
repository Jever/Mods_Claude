import { test, expect, mock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`faixa fica ao lado da de baixo e mostra só o Aprimorar (${surface})`, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Button } = $.ui.resolve(e)
      return <Button key="base" label="base" onPress={() => {}} />
    })
    const ui = await $.ui.mount({
      plugin: 'prompt-enhancer',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false },
    })
    expect(await ui.find({ key: 'base' })).toBeTruthy()
    expect(await ui.find({ key: 'enhance' })).toBeTruthy()
    expect(await ui.find({ key: 'send' })).toBeFalsy()
    await ui.unmount()
  })
}

test('desligado no /mods, o Aprimorar some e a faixa de outros mods segue', async ($, on) => {
  mock.clock(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('fs.exists', async ($, e) => ({ value: (e as { path: string }).path.endsWith('/.claude/mods/switches.json') }) as never)
  on('fs.read', async () => ({ value: '{"prompt-enhancer": false}' }) as never)
  on('ui.render', ($, e) => {
    const { Button } = $.ui.resolve(e)
    return <Button key="base" label="base" onPress={() => {}} />
  })
  await $.session.start({ source: 'startup', cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'prompt-enhancer', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } })
  expect(await ui.find({ key: 'base' })).toBeTruthy()
  expect(await ui.find({ key: 'enhance' })).toBeFalsy()
  await ui.unmount()
})
