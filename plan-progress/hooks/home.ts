// Um caminho como o Windows escreve: uma unidade (C:\ ou C:/) ou um compartilhamento (\\servidor).
const isWindowsPath = (path: string): boolean => /^([A-Za-z]:[\\/]|\\\\)/.test(path)

// A pasta home, tirada da própria pasta do plugin: o trecho antes de /.claude/. O Windows entrega a
// pasta com barras invertidas, então lá elas viram / antes; um caminho do Linux ou do macOS fica como está.
// Um plugin fora de ~/.claude recebe a própria pasta de volta.
export const homeFrom = (root: string): string => (isWindowsPath(root) ? root.replace(/\\/g, '/') : root).split('/.claude/')[0] ?? ''
