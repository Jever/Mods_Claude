import type { EngineInterface } from 'claude-code'

// A path as Windows writes it: a drive (C:\ or C:/) or a share (\\server).
export const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

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

// A folder list such as CLAUDE_CODE_PLUGIN_DIRS, split by the platform's separator: ':' on Linux and
// macOS, ';' on Windows. Windows paths hold no ':' but a drive's, so there a ':' between folders splits
// too, and a list written the Linux way still works.
export function splitDirList(raw: string, windows: boolean): string[] {
  if (!windows) return raw.split(':')
  return raw.split(';').flatMap(part => {
    const out: string[] = []
    let start = 0
    for (let i = 0; i < part.length; i += 1) {
      if (part[i] !== ':') continue
      const isDrive = i - start === 1 && /[A-Za-z]/.test(part[start] ?? '') && /[\\/]/.test(part[i + 1] ?? '')
      if (isDrive) continue
      out.push(part.slice(start, i))
      start = i + 1
    }
    out.push(part.slice(start))
    return out
  })
}
