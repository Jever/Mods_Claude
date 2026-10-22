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
