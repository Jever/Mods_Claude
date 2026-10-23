import type { EngineInterface } from 'claude-code'

// Um caminho como o Windows escreve: uma unidade (C:\ ou C:/) ou um compartilhamento (\\servidor).
const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

// O Windows entrega os caminhos com barras invertidas, então lá elas viram /; um caminho do Linux ou do macOS fica como está.
const slashes = (path: string): string => (isWindowsPath(path) ? path.replace(/\\/g, '/') : path)

// A pasta home, tirada da própria pasta do plugin: o trecho antes de /.claude/. Um plugin lido de uma
// pasta (marketplace de pasta, --plugin-dir) fica fora de ~/.claude: aí vale a home do sistema, ou, sem
// ela, a própria pasta do plugin.
export function homeFrom(root: string, systemHome?: string): string {
  const path = slashes(root)
  const at = path.indexOf('/.claude/')
  if (at !== -1) return path.slice(0, at)
  return systemHome ? slashes(systemHome).replace(/\/+$/, '') : path
}

// A pasta home desta carga. A do sistema (USERPROFILE no Windows, HOME nos outros) só conta quando a
// pasta do plugin está fora de ~/.claude.
export async function findHome($: EngineInterface): Promise<string> {
  let system: string | undefined
  try {
    system = isWindowsPath($.plugin.root) ? ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))) : await $.env.get('HOME')
  } catch {
    system = undefined
  }
  return homeFrom($.plugin.root, system)
}
