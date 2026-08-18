// Regenerates all PWA / favicon PNGs (and favicon.ico) from the canonical
// GoatPaji horn mark in frontend/public/favicon.svg.
//
// Dev-only utility — its deps are intentionally NOT in package.json so they
// never ship to the Railway build. Install them ad hoc before running:
//   npm i -D sharp png-to-ico && node generate-icons.js
const sharp = require('sharp')
const pngToIco = require('png-to-ico').default || require('png-to-ico')
const fs = require('fs')
const path = require('path')

const PUB = path.join(__dirname, 'frontend', 'public')
const SRC = path.join(PUB, 'favicon.svg')

// output file name -> square size in px
const PNGS = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
}

async function main() {
  const svg = fs.readFileSync(SRC)
  for (const [name, size] of Object.entries(PNGS)) {
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(path.join(PUB, name))
  }
  // Bundle 16/32/48 into favicon.ico
  const tmp48 = path.join(PUB, '.ico-48.png')
  await sharp(svg, { density: 384 }).resize(48, 48).png().toFile(tmp48)
  const ico = await pngToIco([
    path.join(PUB, 'favicon-16.png'),
    path.join(PUB, 'favicon-32.png'),
    tmp48,
  ])
  fs.writeFileSync(path.join(PUB, 'favicon.ico'), ico)
  fs.unlinkSync(tmp48)
  console.log('Icons generated from', path.relative(__dirname, SRC))
}

main().catch(e => { console.error(e); process.exit(1) })
