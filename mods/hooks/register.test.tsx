import { expect, mock, test } from 'claude-code/testing'
import { homeFrom, splitDirList } from './home'

// The engine hands a hook each path the way the platform writes it: D:\proj\x on Windows, /proj/x on
// Linux and macOS. The fake disks here are keyed the Linux way, so a Windows path is read as one.
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

const props = { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never

// Os mods instalados hoje, na ordem da tabela do painel.
const INSTALLED = ['cache-keeper', 'prompt-enhancer', 'plan-progress', 'screen-share'] as const

for (const surface of ['desktop', 'terminal'] as const) {
  test(`switches a mod off (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const opened: string[] = []
    const find = (end: string) => Object.keys(files).find(k => k.endsWith(end))

    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    const clock = mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
    on('ui.open', async ($, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    machine(on, files)
    mock.env(on, {})

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.command.run({ command: 'mods', args: '' } as never)
    await clock.settle()
    expect(opened, '/mods opens the pane').toContain('mods')

    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    expect(await v.find({ text: 'Cache Keeper' }), 'first row').toBeDefined()
    expect(await v.find({ text: 'Screen-Share Mode' }), 'last row').toBeDefined()
    expect(await v.find({ text: /Off means off in every chat\. Changes apply within 3 seconds\./ }), 'footer').toBeDefined()
    expect(await v.find({ text: 'New mods appear here by themselves.' }), 'footer line on new mods').toBeDefined()
    expect(await v.find({ text: '/keepwarm' }), 'tip under Cache Keeper').toBeDefined()
    expect(await v.find({ text: '/screen-share to hide private data' }), 'tip under Screen-Share').toBeDefined()
    for (const name of INSTALLED) {
      expect(await v.find({ key: `toggle-${name}` }), `${name} has On/Off`).toBeDefined()
    }

    // Cache Keeper: On to Off writes the whole file with its key set to false.
    await v.press({ key: 'toggle-cache-keeper' })
    const sw = find('/.claude/mods/switches.json') ?? ''
    expect(sw, 'switches.json written under the home folder').not.toBe('')
    expect(JSON.parse(files[sw] ?? '{}'), 'cache-keeper off').toEqual({ 'cache-keeper': false })
    expect(await v.find({ text: 'Cache Keeper is off in every chat.' }), 'note after the press').toBeDefined()
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Open on a pane mod writes the open request while it is On (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    const find = (end: string) => Object.keys(files).find(k => k.endsWith(end))
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: new Date(2026, 9, 15, 21, 0).getTime() })
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    machine(on, files)
    mock.env(on, {})

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })
    expect(await v.find({ key: 'open-plan-progress' }), 'Open on plan-progress').toBeDefined()
    expect(await v.find({ key: 'open-cache-keeper' }), 'no Open on a band mod').toBeUndefined()

    await v.press({ key: 'open-plan-progress' })
    const ask = find('/.claude/mods/.open-plan-progress-sid-123') ?? ''
    expect(ask, 'open request written').not.toBe('')
    expect(files[ask], 'request file is empty').toBe('')
    expect(await v.find({ text: 'Plano e subagentes opens in this chat within 3 seconds.' }), 'note').toBeDefined()

    // Off: Open cannot be pressed.
    await v.press({ key: 'toggle-plan-progress' })
    expect(await v.find({ key: 'open-plan-progress' }), 'no Open while off').toBeUndefined()
    await v.press({ key: 'toggle-plan-progress' })
    expect(await v.find({ key: 'open-plan-progress' }), 'Open again on an On mod').toBeDefined()
  })
}

// A fake machine: the files sit under any home folder, matched by the end of the path.
const disk: Record<string, string> = {
  '/.claude/mods/zeta-notes/.claude-plugin/plugin.json': JSON.stringify({ name: 'zeta-notes', description: 'Keeps short notes beside the chat' }),
  '/.claude/mods/zeta-notes/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/mods/zeta-notes/hooks/register.tsx': "const f = 'switches.json'\nawait $.command.register({ name: 'zeta', description: 'x' })",
  '/.claude/mods/plain-tool/.claude-plugin/plugin.json': JSON.stringify({ name: 'plain-tool', description: 'Does one plain thing' }),
  '/.claude/mods/plain-tool/hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
  '/.claude/mods/plain-tool/hooks/register.ts': "await $.command.register({ name: 'plain' })",
  '/.claude/mods/not-a-mod/.claude-plugin/plugin.json': JSON.stringify({ name: 'not-a-mod' }),
  '/.claude/mods/not-a-mod/hooks/hooks.json': JSON.stringify({ hooks: {} }),
  '/.claude/mods/mods/.claude-plugin/plugin.json': JSON.stringify({ name: 'mods' }),
  '/.claude/mods/mods/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/opt/extra\b/alpha-env/.claude-plugin/plugin.json': JSON.stringify({ name: 'alpha-env', description: 'Found through the env list' }),
  '/opt/extra\b/alpha-env/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/opt/extra\b/alpha-env/hooks/register.tsx': "'switches.json'",
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/.claude-plugin/plugin.json': JSON.stringify({ name: 'replay-theater', description: 'Replays each edit' }),
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/plugins/cache/anthropic/replay-theater/0.1.0/hooks/register.tsx': "await $.command.register({ name: 'replay' })",
  '/.claude/dev-mods/sid-123/brand-new/.claude-plugin/plugin.json': JSON.stringify({ name: 'brand-new', description: 'Made in this chat' }),
  '/.claude/dev-mods/sid-123/brand-new/hooks/hooks.json': JSON.stringify({ modules: ['./register.tsx'] }),
  '/.claude/dev-mods/sid-123/brand-new/hooks/register.tsx': "'switches.json'",
}
const dirs: Record<string, string[]> = {
  '/.claude/mods': ['zeta-notes', 'plain-tool', 'not-a-mod', 'mods'],
  '/.claude/dev-mods/sid-123': ['brand-new'],
  '/.claude/plugins/cache': ['anthropic'],
  '/.claude/plugins/cache/anthropic': ['replay-theater'],
  '/.claude/plugins/cache/anthropic/replay-theater': ['0.1.0'],
}
// The mods installed from the jeverjm marketplace: in the plugin cache, one folder per mod and version.
for (const name of INSTALLED) {
  const base = `/.claude/plugins/cache/jeverjm/${name}/0.1.0`
  disk[`${base}/.claude-plugin/plugin.json`] = JSON.stringify({ name, description: `${name} plugin` })
  disk[`${base}/hooks/hooks.json`] = JSON.stringify({ modules: ['./register.tsx'] })
  disk[`${base}/hooks/register.tsx`] = "'switches.json'"
  dirs[`/.claude/plugins/cache/jeverjm/${name}`] = ['0.1.0']
}
dirs['/.claude/plugins/cache/jeverjm'] = [...INSTALLED]
dirs['/.claude/plugins/cache'] = ['anthropic', 'jeverjm']

const onDisk = (path: string) => Object.keys(disk).find(k => path.endsWith(k))

// A fake machine for every test: the files written in the test, plus the disk below (matched by the end of the path).
const machine = (on: On, files: Record<string, string>) => {
  on('fs.exists', async ($, e) => {
    const path = posix((e as { path: string }).path)
    return { value: path in files || onDisk(path) !== undefined } as never
  })
  on('fs.read', async ($, e) => {
    const path = posix((e as { path: string }).path)
    if (path in files) return { value: files[path] } as never
    const k = onDisk(path)
    if (k === undefined) throw new Error(`ENOENT ${path}`)
    return { value: disk[k] } as never
  })
  on('fs.write', async ($, e) => {
    const { text } = e as { path: string; text: string }
    const path = posix((e as { path: string }).path)
    files[path] = text
    return { value: undefined } as never
  })
  on('fs.list', async ($, e) => {
    const path = posix((e as { path?: string }).path ?? '').replace(/\/+$/, '')
    const dir = Object.keys(dirs).find(k => path.endsWith(k))
    if (dir) return { value: (dirs[dir] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
    const names = [...new Set(Object.keys(disk).filter(k => path.endsWith(k.slice(0, k.lastIndexOf('/')))).map(k => k.slice(k.lastIndexOf('/') + 1)))]
    if (!names.length) throw new Error(`ENOENT ${path}`)
    return { value: names.map(name => ({ name, kind: 'file', size: 10, mtimeMs: 0, isLink: false })) } as never
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`finds new mods by itself, and a mod without the switch gets a note (${surface})`, { timeoutMs: 20000 }, async ($, on) => {
    const files: Record<string, string> = {}
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('session.id', async () => ({ value: 'sid-123' }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    mock.clock(on, { now: new Date(2026, 9, 16, 9, 0).getTime() })
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
    on('fs.exists', async ($, e) => {
      const path = posix((e as { path: string }).path)
      return { value: path in files || onDisk(path) !== undefined } as never
    })
    on('fs.read', async ($, e) => {
      const path = posix((e as { path: string }).path)
      if (path in files) return { value: files[path] } as never
      const k = onDisk(path)
      if (k === undefined) throw new Error(`ENOENT ${path}`)
      return { value: disk[k] } as never
    })
    on('fs.write', async ($, e) => {
      const { text } = e as { path: string; text: string }
      const path = posix((e as { path: string }).path)
      files[path] = text
      return { value: undefined } as never
    })
    on('fs.list', async ($, e) => {
      const path = posix((e as { path?: string }).path ?? '').replace(/\/+$/, '')
      const dir = Object.keys(dirs).find(k => path.endsWith(k))
      if (dir) return { value: (dirs[dir] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
      const names = [...new Set(Object.keys(disk).filter(k => path.endsWith(k.slice(0, k.lastIndexOf('/')))).map(k => k.slice(k.lastIndexOf('/') + 1)))]
      if (!names.length) throw new Error(`ENOENT ${path}`)
      return { value: names.map(name => ({ name, kind: 'file', size: 10, mtimeMs: 0, isLink: false })) } as never
    })
    mock.env(on, { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/context-meter:/opt/extra\b/alpha-env/' })

    await $.session.start({ source: 'startup', cwd: '/Users/test/vault', surface, isInteractive: true } as never)
    await $.command.run({ command: 'mods', args: '' } as never)
    const v = await $.ui.mount({ plugin: 'mods', surface, component: 'Pane', requestId: 'mods', props })

    // New mods appear, named from plugin.json, with the description and the slash command.
    expect(await v.find({ text: 'Zeta Notes' }), 'new mod in ~/.claude/mods').toBeDefined()
    expect(await v.find({ text: 'Keeps short notes beside the chat' }), 'its description').toBeDefined()
    expect(await v.find({ text: '/zeta' }), 'its slash command').toBeDefined()
    expect(await v.find({ key: 'toggle-zeta-notes' }), 'it reads switches.json, so it has On/Off').toBeDefined()
    expect(await v.find({ text: 'Alpha Env' }), 'mod from CLAUDE_CODE_PLUGIN_DIRS').toBeDefined()
    expect(await v.find({ text: 'Replay Theater' }), 'mod installed from a marketplace').toBeDefined()
    expect(await v.find({ text: 'Brand New' }), "this chat's own new mod").toBeDefined()
    expect(await v.find({ text: 'This chat only' }), 'labelled This chat only').toBeDefined()

    // No switch in its source: a note and no toggle.
    expect(await v.find({ text: 'Plain Tool' }), 'plain-tool is listed').toBeDefined()
    expect(await v.find({ key: 'toggle-plain-tool' }), 'no toggle for plain-tool').toBeUndefined()
    expect(await v.find({ text: 'Not switchable yet. Ask Claude: add the /mods switch to this mod.' }), 'the note').toBeDefined()

    // Not mods: a plain plugin, and the switchboard itself.
    expect(await v.find({ text: 'Not A Mod' }), 'no modules key, not a mod').toBeUndefined()
    expect(await v.find({ key: 'toggle-mods' }), 'the switchboard skips itself').toBeUndefined()

    // Known ones keep their rows and names.
    expect(await v.find({ key: 'toggle-cache-keeper' }), 'Cache Keeper keeps On/Off').toBeDefined()
    expect(await v.find({ key: 'toggle-prompt-enhancer' }), 'Prompt Enhancer keeps On/Off').toBeDefined()
    expect(await v.find({ key: 'open-plan-progress' }), 'plan-progress keeps its Open button').toBeDefined()

    // Order: the installed table, then new ones A to Z, then this chat's own.
    const order = (await v.findAll({ type: 'Box' })).map(b => b.key ?? '').filter(k => k.startsWith('row-')).map(k => k.slice(4))
    expect(order.slice(0, INSTALLED.length), 'the installed table first').toEqual([...INSTALLED])
    expect(order.slice(INSTALLED.length), 'then A to Z, then this chat only').toEqual(['alpha-env', 'plain-tool', 'replay-theater', 'zeta-notes', 'brand-new'])

    // A found mod switches like a known one.
    await v.press({ key: 'toggle-zeta-notes' })
    const sw = Object.keys(files).find(k => k.endsWith('/.claude/mods/switches.json')) ?? ''
    expect(JSON.parse(files[sw] ?? '{}'), 'zeta-notes off').toEqual({ 'zeta-notes': false })
    expect(await v.find({ text: 'Zeta Notes is off in every chat.' }), 'note').toBeDefined()
  })
}

// The home folder comes from the plugin folder, which arrives with backslashes on Windows.
test('the home folder comes from the plugin folder, on Windows and on Linux', async () => {
  expect(homeFrom('C:\\Users\\test user\\.claude\\plugins\\cache\\jeverjm\\mods\\0.1.0'), 'Windows').toBe('C:/Users/test user')
  expect(homeFrom('/home/test/.claude/plugins/cache/jeverjm/mods/0.1.0'), 'Linux').toBe('/home/test')
  expect(homeFrom('/Users/test/.claude/plugins/cache/jeverjm/mods/0.1.0'), 'macOS').toBe('/Users/test')
  expect(homeFrom('/home/a\\b/.claude/plugins/cache/jeverjm/mods/0.1.0'), 'a Linux name with a backslash').toBe('/home/a\\b')
  expect(homeFrom('/home/test/.claude/plugins/cache/jeverjm/mods/0.1.0', '/other'), "inside ~/.claude the system's home does not count").toBe('/home/test')
})

// Read from a folder (a folder marketplace, --plugin-dir), the plugin sits outside ~/.claude: the system's home is used.
test("outside ~/.claude, the home folder is the system's", async () => {
  expect(homeFrom('D:\\ProjetosPessoais\\Mods_Claude\\mods', 'C:\\Users\\test user'), 'Windows').toBe('C:/Users/test user')
  expect(homeFrom('/opt/mods/mods', '/home/test/'), 'Linux').toBe('/home/test')
  expect(homeFrom('D:\\ProjetosPessoais\\Mods_Claude\\mods'), "no system home, on Windows").toBe('D:/ProjetosPessoais/Mods_Claude/mods')
  expect(homeFrom('/opt/mods/mods'), 'no system home, on Linux').toBe('/opt/mods/mods')
})

// CLAUDE_CODE_PLUGIN_DIRS is split by ':' on Linux and macOS and by ';' on Windows.
test('the plugin folder list splits the way the platform writes it', async () => {
  expect(splitDirList('~/.claude/mods/a:/opt/extra/b/', false), 'Linux').toEqual(['~/.claude/mods/a', '/opt/extra/b/'])
  expect(splitDirList('/opt/a;b:/opt/c', false), "a ';' is part of a Linux name").toEqual(['/opt/a;b', '/opt/c'])
  expect(splitDirList('C:\\mods\\a;D:/mods/b', true), 'Windows').toEqual(['C:\\mods\\a', 'D:/mods/b'])
  expect(splitDirList('~/.claude/mods/a:/opt/extra/b/', true), 'a list written the Linux way, on Windows').toEqual(['~/.claude/mods/a', '/opt/extra/b/'])
  expect(splitDirList('C:\\mods\\a:D:\\mods\\b', true), "':' between Windows folders").toEqual(['C:\\mods\\a', 'D:\\mods\\b'])
})
