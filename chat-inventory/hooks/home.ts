// A path as Windows writes it: a drive (C:\ or C:/) or a share (\\server).
const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

// The home folder, taken from the plugin's own folder: the part before /.claude/. Windows hands the
// folder over with backslashes, so there they become / first; a Linux or macOS path is left as it is.
// A plugin outside ~/.claude gets its own folder back.
export const homeFrom = (root: string): string => (isWindowsPath(root) ? root.replace(/\\/g, '/') : root).split('/.claude/')[0] ?? ''
