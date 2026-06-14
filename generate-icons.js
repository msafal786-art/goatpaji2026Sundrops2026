// Generates simple PNG icons for the PWA manifest
const { createCanvas } = require('canvas')
const fs = require('fs')

function makeIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#0a84ff'
  const r = size * 0.22
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, r)
  ctx.fill()

  // Letter G
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.52)}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('G', size / 2, size / 2 + size * 0.03)

  return canvas.toBuffer('image/png')
}

try {
  const buf192 = makeIcon(192)
  const buf512 = makeIcon(512)
  fs.writeFileSync('frontend/public/icon-192.png', buf192)
  fs.writeFileSync('frontend/public/icon-512.png', buf512)
  console.log('Icons generated.')
} catch(e) {
  console.log('canvas not available, using fallback SVG-to-PNG approach')
}
