// Bichinhos: um caranguejo pixel do Claude, uma cor de corpo por subagente.
// O desktop desenha o SVG; o terminal usa texto (ver subagents.ts).

export type Px = [x: number, y: number]

// Oito cores de corpo fáceis de distinguir e legíveis no claro e no escuro.
export const HUES: { name: string; color: string }[] = [
  { name: 'red', color: '#dc2626' },
  { name: 'orange', color: '#ea580c' },
  { name: 'yellow', color: '#eab308' },
  { name: 'green', color: '#16a34a' },
  { name: 'teal', color: '#0d9488' },
  { name: 'blue', color: '#2563eb' },
  { name: 'purple', color: '#9333ea' },
  { name: 'pink', color: '#db2777' },
]
export const hueOf = (hue: number) => HUES[((hue % HUES.length) + HUES.length) % HUES.length]!

// Olhos e contorno são iguais em todos os bichinhos.
const EYE = '#2b1d16'
const OUTLINE = '#2b1d16'
export const FRAMES = 4

const span = (y: number, from: number, to: number): Px[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y] as Px)

/**
 * Um quadro do caranguejo numa grade de 16 por 12. Quadro 0 fica de pé; 1 pula um pixel
 * com as pernas trocadas; 2 fica de pé e pisca; 3 levanta as duas pinças.
 */
function crab(frame: number): { body: Px[]; eyes: Px[] } {
  const dy = frame === 1 ? 0 : 1
  const clawsUp = frame === 3
  const body: Px[] = [
    ...span(1, 3, 12),
    ...span(2, 3, 12),
    ...span(3, 3, 12),
    ...(clawsUp ? span(4, 3, 12) : span(4, 1, 14)),
    ...(clawsUp ? span(5, 3, 12) : span(5, 1, 14)),
    ...span(6, 3, 12),
    ...span(7, 3, 12),
  ]
  if (clawsUp) body.push([1, 2], [2, 2], [1, 3], [2, 3], [13, 2], [14, 2], [13, 3], [14, 3])
  const legs = frame % 2 === 1 ? [3, 5, 10, 12] : [4, 6, 9, 11]
  for (const x of legs) body.push([x, 8], [x, 9])
  const eyes: Px[] = frame === 2 ? [[5, 4], [10, 4]] : [[5, 3], [5, 4], [10, 3], [10, 4]]
  const move = (p: Px): Px => [p[0], p[1] + dy]
  return { body: body.map(move), eyes: eyes.map(move) }
}

const petCache = new Map<string, string>()

export function petSvg(hue: number, frame: number) {
  const key = `${hue % HUES.length}:${frame}`
  const hit = petCache.get(key)
  if (hit) return hit
  const { body, eyes } = crab(frame)
  const fill = hueOf(hue).color
  const has = new Set(body.map(([x, y]) => `${x},${y}`))
  // Um contorno de um pixel em volta do corpo, para toda cor aparecer no claro e no escuro.
  const ring = new Set<string>()
  for (const [x, y] of body) {
    for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Px[]) {
      const k = `${ax},${ay}`
      if (!has.has(k)) ring.add(k)
    }
  }
  const rect = (x: number, y: number, c: string) => `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${c}"/>`
  const parts = [
    ...[...ring].map(k => {
      const [x, y] = k.split(',').map(Number)
      return rect(x!, y!, OUTLINE)
    }),
    ...body.map(([x, y]) => rect(x, y, fill)),
    ...eyes.map(([x, y]) => rect(x, y, EYE)),
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 13" width="48" height="36" shape-rendering="crispEdges">${parts.join('')}</svg>`
  petCache.set(key, svg)
  return svg
}
