// Barra de cada card de subagente em SVG (desktop). No terminal a barra é texto.

import type { HelperPhase } from '../types'

const BAD = '#dc2626'
const CELL = 3

export const CARD_BAR_H = 10

// Ruído fixo: as faíscas ficam paradas entre os redesenhos, e só o brilho CSS se move.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** Classes de brilho s0 a s3, fora de fase; `slow` para uma barra concluída. */
const twinkleCss = (slow: boolean) =>
  `.s0,.s1,.s2,.s3{animation:tw ${slow ? 3.2 : 2.1}s ease-in-out infinite}` +
  `.s1{animation-duration:${slow ? 3.8 : 2.7}s;animation-delay:-.7s}.s2{animation-duration:${slow ? 4.4 : 1.8}s;animation-delay:-1.3s}` +
  `.s3{animation-duration:${slow ? 3.5 : 3.1}s;animation-delay:-.4s}` +
  `@keyframes tw{0%,100%{opacity:.95}50%{opacity:${slow ? 0.55 : 0.15}}}`

/** Quadrados pontilhados em `w` por `h` pixels: esparsos à esquerda, densos à direita. */
function sparkles(w: number, h: number, size: number, base: number, rise: number, salt = 0): string {
  const cols = Math.floor(w / CELL)
  const rows = Math.max(1, Math.floor(h / CELL))
  const out: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = base + rise * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) {
      if (noise(c + salt, r) < density) {
        out.push(`<rect class="s${Math.floor(noise(r, c + salt) * 4)}" x="${c * CELL + 0.5}" y="${r * CELL + (h - rows * CELL) / 2 + 0.5}" width="${size}" height="${size}"/>`)
      }
    }
  }
  return out.join('')
}

/**
 * A barra de progresso do plano no desktop: degradê roxo que enche com o avanço, faíscas e um brilho
 * que percorre o trecho preenchido. Só a posição do brilho se move; o resto é fixo entre os redesenhos.
 */
export function planBarSvg(percent: number, W: number): string {
  const H = 14
  const fillW = Math.round((W * Math.max(0, Math.min(100, percent))) / 100)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${twinkleCss(false)}
.sw{animation:sw 2.4s linear infinite}
@keyframes sw{from{transform:translateX(-80px)}to{transform:translateX(${fillW + 80}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.sw{animation:none}}
</style>
<defs>
<linearGradient id="pb-g" x1="0" x2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>
<linearGradient id="pb-s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="pb-c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>
<clipPath id="pb-f"><rect width="${fillW}" height="${H}"/></clipPath>
</defs>
<g clip-path="url(#pb-c)">
<rect width="${W}" height="${H}" fill="#8b5cf6" opacity=".16"/>
${fillW > 0 ? `<rect width="${fillW}" height="${H}" fill="url(#pb-g)"/>` : ''}
<g fill="#ffffff">${sparkles(fillW, H, 1.6, 0.12, 0.4)}</g>
${fillW > 0 ? `<g clip-path="url(#pb-f)"><rect class="sw" width="80" height="${H}" fill="url(#pb-s)"/></g>` : ''}
</g>
</svg>`
}

/**
 * Uma barra grossa de faíscas por card. Enquanto trabalha, um trecho claro percorre a
 * barra (o tamanho do trabalho é desconhecido); ao terminar, a barra enche e brilha devagar.
 * O desenho depende só da fase, então o CSS move a barra e os redesenhos não a reiniciam.
 */
export function cardBarSvg(phase: HelperPhase, color: string, W: number, seat: number): string {
  const id = `hdc${seat}`
  const H = CARD_BAR_H
  const fill = phase === 'failed' ? BAD : color
  const piece = Math.max(30, Math.round(W * 0.35))
  const working = phase === 'working'
  const body = working
    ? `<g class="mv"><rect width="${piece}" height="${H}" fill="url(#${id}-p)"/><g fill="#ffffff">${sparkles(piece, H, 1.6, 0.1, 0.35, seat * 11)}</g></g>`
    : `<rect width="${W}" height="${H}" fill="url(#${id}-g)"/><g fill="#ffffff">${sparkles(W, H, 1.6, 0.18, 0.3, seat * 11)}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${twinkleCss(!working)}
.mv{animation:mv${seat} 1.8s ease-in-out infinite;animation-delay:-${(seat * 0.37) % 1.8}s}
@keyframes mv${seat}{from{transform:translateX(-${piece}px)}to{transform:translateX(${W}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.mv{animation:none}}
</style>
<defs>
<linearGradient id="${id}-g" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity=".55"/><stop offset="1" stop-color="${fill}"/></linearGradient>
<linearGradient id="${id}-p" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity="0"/><stop offset=".7" stop-color="${fill}"/><stop offset="1" stop-color="${fill}" stop-opacity=".9"/></linearGradient>
<clipPath id="${id}-c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>
</defs>
<g clip-path="url(#${id}-c)">
<rect width="${W}" height="${H}" fill="${fill}" opacity=".16"/>
${body}
</g>
</svg>`
}
