import { test, expect, mock } from 'claude-code/testing'
import { homeFrom } from './home'

// O engine entrega cada caminho ao hook como o sistema escreve: D:\proj\x no Windows, /proj/x no Linux
// e no macOS. Os discos falsos daqui usam o jeito do Linux, então um caminho do Windows é lido como um deles.
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

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
  on('fs.exists', async ($, e) => ({ value: posix((e as { path: string }).path).endsWith('/.claude/mods/switches.json') }) as never)
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

// A pasta home vem da pasta do plugin. No Windows ela chega com barras invertidas.
test('a pasta home sai da pasta do plugin, no Windows e no Linux', async () => {
  expect(homeFrom('C:\\Users\\test user\\.claude\\plugins\\cache\\jeverjm\\prompt-enhancer\\0.1.0'), 'Windows').toBe('C:/Users/test user')
  expect(homeFrom('/home/test/.claude/plugins/cache/jeverjm/prompt-enhancer/0.1.0'), 'Linux').toBe('/home/test')
  expect(homeFrom('/Users/test/.claude/plugins/cache/jeverjm/prompt-enhancer/0.1.0'), 'macOS').toBe('/Users/test')
  expect(homeFrom('/home/a\\b/.claude/plugins/cache/jeverjm/prompt-enhancer/0.1.0'), 'um nome do Linux com barra invertida').toBe('/home/a\\b')
  expect(homeFrom('D:\\ProjetosPessoais\\Mods_Claude\\prompt-enhancer'), 'fora de ~/.claude, no Windows').toBe('D:/ProjetosPessoais/Mods_Claude/prompt-enhancer')
  expect(homeFrom('/opt/mods/prompt-enhancer'), 'fora de ~/.claude, no Linux').toBe('/opt/mods/prompt-enhancer')
})
