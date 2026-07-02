#!/usr/bin/env node
// Dependency-free test relay for POST /api/ingest.
// Requires Node 20+ (built-in fetch, FormData, Blob, crypto).
//
// Usage:
//   node scripts/fake-relay.mjs <url> <secret> [flags]
//   e.g. node scripts/fake-relay.mjs http://localhost:3350 my-secret
//
// Happy-path / behavior flags:
//   --source <s>     source field (default: pegasus)
//   --target <t>     targetName field (default: "TEST — M31")
//   --empty-target   send targetName="" (exercises the absent/Unknown path)
//   --repeat <n>     send n frames, 2s apart, each with unique bytes
//   --dup            send the SAME bytes twice (proves sha256 dedup)
//
// Failure-matrix flags (each sends one request):
//   --wrong-secret   bad bearer token                 (expect 401)
//   --no-image       omit the image field             (expect 400)
//   --bad-magic      text bytes claiming image/jpeg   (expect 400)
//   --oversize       >10MB body                       (expect 400)
//   --bad-metadata   ~100KB metadata string           (expect 201, metadata null)
//
// Image bytes: a tiny hardcoded valid JPEG (FF D8 FF ... FF D9) with random
// bytes appended after the EOI marker to vary the sha256 per send. Decoders
// tolerate trailing bytes; the server only needs the magic bytes + a unique
// hash.

import { randomBytes } from 'node:crypto'

// 1x1 baseline JPEG. Starts FF D8 FF E0 (SOI + APP0/JFIF), ends FF D9 (EOI).
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q=='

const baseJpeg = () => Buffer.from(TINY_JPEG_B64, 'base64')

// Valid JPEG whose hash differs each call (random trailing bytes after EOI).
const uniqueJpeg = () => Buffer.concat([baseJpeg(), randomBytes(16)])

function parseArgs(argv) {
  const [url, secret, ...rest] = argv
  const opts = {
    url,
    secret,
    source: 'pegasus',
    target: 'TEST — M31',
    emptyTarget: false,
    repeat: 0,
    dup: false,
    wrongSecret: false,
    noImage: false,
    badMagic: false,
    oversize: false,
    badMetadata: false,
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    switch (a) {
      case '--source': opts.source = rest[++i]; break
      case '--target': opts.target = rest[++i]; break
      case '--empty-target': opts.emptyTarget = true; break
      case '--repeat': opts.repeat = parseInt(rest[++i], 10); break
      case '--dup': opts.dup = true; break
      case '--wrong-secret': opts.wrongSecret = true; break
      case '--no-image': opts.noImage = true; break
      case '--bad-magic': opts.badMagic = true; break
      case '--oversize': opts.oversize = true; break
      case '--bad-metadata': opts.badMetadata = true; break
      default:
        console.error(`unknown flag: ${a}`)
        process.exit(2)
    }
  }
  return opts
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Build and POST one request. `bytes` overrides the image payload (used by
// --dup to send identical bytes twice).
async function send(opts, label, bytes) {
  const form = new FormData()

  if (!opts.noImage) {
    let buf
    let type = 'image/jpeg'
    if (opts.badMagic) {
      buf = Buffer.from('this is plainly text, not an image at all')
      type = 'image/jpeg' // lie about the type; magic-byte check should catch it
    } else if (opts.oversize) {
      buf = Buffer.concat([baseJpeg(), randomBytes(11 * 1024 * 1024)]) // >10MB
    } else {
      buf = bytes ?? uniqueJpeg()
    }
    form.append('image', new Blob([buf], { type }), 'frame.jpg')
  }

  form.append('source', opts.source)

  if (opts.emptyTarget) form.append('targetName', '')
  else if (opts.target != null) form.append('targetName', opts.target)

  if (opts.badMetadata) {
    form.append('metadata', JSON.stringify({ junk: 'x'.repeat(100 * 1024) })) // ~100KB
  } else {
    form.append('metadata', JSON.stringify({ test: true, sentAt: new Date().toISOString() }))
  }

  form.append('capturedAt', new Date().toISOString())

  const token = opts.wrongSecret ? 'totally-wrong-secret-value' : opts.secret

  // Do NOT set Content-Type manually — fetch adds the multipart boundary.
  const res = await fetch(`${opts.url}/api/ingest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })

  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  console.log(`${label.padEnd(22)} → ${res.status}  ${JSON.stringify(body)}`)
  return { status: res.status, body }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.url || !opts.secret) {
    console.error('usage: node scripts/fake-relay.mjs <url> <secret> [flags]')
    process.exit(1)
  }

  const anyFailureFlag =
    opts.wrongSecret || opts.noImage || opts.badMagic || opts.oversize || opts.badMetadata

  if (opts.dup) {
    const shared = uniqueJpeg()
    await send(opts, 'dup #1 (insert)', shared)
    await send(opts, 'dup #2 (deduped)', shared)
    return
  }

  if (opts.repeat > 0) {
    for (let i = 1; i <= opts.repeat; i++) {
      await send(opts, `repeat ${i}/${opts.repeat}`, undefined)
      if (i < opts.repeat) await sleep(2000)
    }
    return
  }

  // Single send — label reflects whichever failure flag is active.
  const label = anyFailureFlag
    ? Object.entries({
        wrongSecret: '--wrong-secret',
        noImage: '--no-image',
        badMagic: '--bad-magic',
        oversize: '--oversize',
        badMetadata: '--bad-metadata',
      }).find(([k]) => opts[k])[1]
    : 'normal'
  await send(opts, label, undefined)
}

main().catch((e) => {
  console.error('fake-relay error:', e)
  process.exit(1)
})
