// A path as Windows writes it: a drive (C:\ or C:/) or a share (\\server).
export const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

// The home folder, taken from the plugin's own folder: the part before /.claude/. Windows hands the
// folder over with backslashes, so there they become / first; a Linux or macOS path is left as it is.
// A plugin outside ~/.claude gets its own folder back.
export const homeFrom = (root: string): string => (isWindowsPath(root) ? root.replace(/\\/g, '/') : root).split('/.claude/')[0] ?? ''

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
