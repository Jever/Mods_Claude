import type { EngineInterface } from 'claude-code'

// A path as Windows writes it: a drive (C:\ or C:/) or a share (\\server).
const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

// Windows hands paths over with backslashes, so there they become /; a Linux or macOS path is left as it is.
const slashes = (path: string): string => (isWindowsPath(path) ? path.replace(/\\/g, '/') : path)

// The home folder, taken from the plugin's own folder: the part before /.claude/. A plugin read from a
// folder (a folder marketplace, --plugin-dir) sits outside ~/.claude: then the home is the system's,
// or, without one, the plugin's own folder.
export function homeFrom(root: string, systemHome?: string): string {
  const path = slashes(root)
  const at = path.indexOf('/.claude/')
  if (at !== -1) return path.slice(0, at)
  return systemHome ? slashes(systemHome).replace(/\/+$/, '') : path
}

// This load's home folder. The system's (USERPROFILE on Windows, HOME elsewhere) counts only when the
// plugin's folder is outside ~/.claude.
export async function findHome($: EngineInterface): Promise<string> {
  let system: string | undefined
  try {
    system = isWindowsPath($.plugin.root) ? ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))) : await $.env.get('HOME')
  } catch {
    system = undefined
  }
  return homeFrom($.plugin.root, system)
}
