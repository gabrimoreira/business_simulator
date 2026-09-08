/**
 * Gera os ícones e splash screens do PWA sem depender de `sharp` nem de qualquer
 * binário de imagem: escreve PNG na mão (RGBA8, filtro 0) usando `node:zlib`.
 *
 *   npm run icons
 *
 * A saída é determinística e vai versionada em `public/`, então isto roda uma vez
 * e só é executado de novo se a identidade visual mudar.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x0a, 0x0a, 0x0b]
const SURFACE = [0x16, 0x16, 0x1d]
const ACCENT = [0x10, 0xb9, 0x81]
const ACCENT_DIM = [0x06, 0x5f, 0x46]

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** `paint(x, y)` devolve [r, g, b, a] com a em 0-255. */
function writePng(path, width, height, paint) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0 // filtro None
    offset += 1
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
      offset += 4
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
  return png.length
}

// --- Desenho -----------------------------------------------------------------

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

/** Cobertura (0-1) de um retângulo arredondado, com antialias por distância. */
function roundedRectCoverage(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy
  const distance = Math.hypot(dx, dy)
  if (x < left - 1 || x > right + 1 || y < top - 1 || y > bottom + 1) return 0
  return Math.max(0, Math.min(1, radius - distance + 0.5))
}

/**
 * O glifo: três barras ascendentes (o gráfico que sobe) com a última em destaque.
 * `inset` é a fração da borda reservada — a zona segura do ícone maskable.
 */
function glyphCoverage(x, y, size, inset) {
  const pad = size * inset
  const area = size - pad * 2
  const barGap = area * 0.1
  const barWidth = (area - barGap * 2) / 3
  const radius = barWidth * 0.28
  const heights = [0.42, 0.68, 1]

  for (let i = 0; i < 3; i += 1) {
    const left = pad + i * (barWidth + barGap)
    const right = left + barWidth
    const height = area * heights[i]
    const bottom = pad + area
    const top = bottom - height
    const coverage = roundedRectCoverage(x, y, left, top, right, bottom, radius)
    if (coverage > 0) return { coverage, index: i }
  }
  return { coverage: 0, index: -1 }
}

function paintIcon(size, { maskable }) {
  const inset = maskable ? 0.26 : 0.2
  const cornerRadius = maskable ? 0 : size * 0.22
  return (x, y) => {
    const bgCoverage = maskable
      ? 1
      : roundedRectCoverage(x, y, 0, 0, size - 1, size - 1, cornerRadius)
    if (bgCoverage <= 0) return [0, 0, 0, 0]

    // Fundo com um leve gradiente diagonal, para não ficar chapado.
    const t = (x / size + y / size) / 2
    const base = mix(SURFACE, BG, t)

    const { coverage, index } = glyphCoverage(x, y, size, inset)
    if (coverage > 0) {
      const barColor = index === 2 ? ACCENT : mix(ACCENT_DIM, ACCENT, index * 0.35)
      const color = mix(base, barColor, Math.min(1, coverage))
      return [color[0], color[1], color[2], Math.round(255 * bgCoverage)]
    }
    return [base[0], base[1], base[2], Math.round(255 * bgCoverage)]
  }
}

function paintSplash(width, height) {
  const glyphSize = Math.round(Math.min(width, height) * 0.3)
  const originX = Math.round((width - glyphSize) / 2)
  const originY = Math.round((height - glyphSize) / 2)
  return (x, y) => {
    const gx = x - originX
    const gy = y - originY
    if (gx >= 0 && gy >= 0 && gx < glyphSize && gy < glyphSize) {
      const { coverage, index } = glyphCoverage(gx, gy, glyphSize, 0.08)
      if (coverage > 0) {
        const barColor = index === 2 ? ACCENT : mix(ACCENT_DIM, ACCENT, index * 0.35)
        const color = mix(BG, barColor, Math.min(1, coverage))
        return [color[0], color[1], color[2], 255]
      }
    }
    return [BG[0], BG[1], BG[2], 255]
  }
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#16161d"/>
  <g fill="#10b981">
    <rect x="13" y="35" width="10" height="16" rx="3" fill="#0f8a63"/>
    <rect x="27" y="26" width="10" height="25" rx="3" fill="#12a274"/>
    <rect x="41" y="13" width="10" height="38" rx="3"/>
  </g>
</svg>
`

const targets = [
  ['icon-192.png', 192, 192, paintIcon(192, { maskable: false })],
  ['icon-512.png', 512, 512, paintIcon(512, { maskable: false })],
  ['icon-maskable-512.png', 512, 512, paintIcon(512, { maskable: true })],
  ['apple-touch-icon-180.png', 180, 180, paintIcon(180, { maskable: true })],
  ['splash-750x1334.png', 750, 1334, paintSplash(750, 1334)],
  ['splash-1170x2532.png', 1170, 2532, paintSplash(1170, 2532)],
  ['splash-1284x2778.png', 1284, 2778, paintSplash(1284, 2778)],
]

for (const [name, width, height, paint] of targets) {
  const bytes = writePng(join(OUT, name), width, height, paint)
  process.stdout.write(`${name} ${width}x${height} ${(bytes / 1024).toFixed(1)} kB\n`)
}

writeFileSync(join(OUT, 'favicon.svg'), FAVICON_SVG)
process.stdout.write('favicon.svg\n')
