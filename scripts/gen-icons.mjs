/**
 * gen-icons.mjs — Generate PWA icons via sharp
 * Usage: node scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const sizes = [96, 180, 192, 512]

for (const size of sizes) {
  const r = Math.round(size * 0.18)
  const fontSize = Math.round(size * 0.52)
  const dotR = Math.round(size * 0.065)
  const dotCx = Math.round(size * 0.72)
  const dotCy = Math.round(size * 0.68)
  const borderW = Math.round(size * 0.025)
  const innerX = Math.round(size * 0.08)
  const innerW = Math.round(size * 0.84)

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a1628"/>
      <stop offset="100%" stop-color="#0d1f3c"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${size}" height="${size}" fill="#0a0a0f"/>
  <!-- Card -->
  <rect x="${innerX}" y="${innerX}" width="${innerW}" height="${innerW}" rx="${r}" ry="${r}"
        fill="url(#bg)" stroke="#00e5ff" stroke-width="${borderW}"/>
  <!-- D letter -->
  <text x="${Math.round(size * 0.46)}" y="${Math.round(size * 0.52)}"
        font-family="-apple-system, system-ui, sans-serif"
        font-size="${fontSize}" font-weight="bold"
        fill="#00e5ff" text-anchor="middle" dominant-baseline="middle">D</text>
  <!-- Green dot -->
  <circle cx="${dotCx}" cy="${dotCy}" r="${dotR}" fill="#39ff14"/>
</svg>`

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(OUT, `icon-${size}.png`))

  console.log(`✅ icon-${size}.png`)
}

console.log('\nAll icons generated in public/icons/')
