#!/usr/bin/env node
// Downloads the pinned uv binary for the current build host.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pin = JSON.parse(readFileSync(join(root, 'resources/agent-pin.json'), 'utf-8'))
const version = process.env.UV_VERSION || pin.uvVersion

const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc'
}

const key = `${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const triple = targets[key]
if (!triple) {
  console.error(`Unsupported build host: ${process.platform}-${process.arch}`)
  process.exit(1)
}

const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
const archiveName = `uv-${triple}.${ext}`
const baseUrl = `https://github.com/astral-sh/uv/releases/download/${version}`
const outputDir = join(root, 'resources/uv', key)
const binaryName = process.platform === 'win32' ? 'uv.exe' : 'uv'
const outputBinary = join(outputDir, binaryName)

if (existsSync(outputBinary) && !process.env.FORCE_UV_DOWNLOAD) {
  console.log(`uv already present at ${outputBinary} (set FORCE_UV_DOWNLOAD=1 to re-download)`)
  process.exit(0)
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const archive = await download(`${baseUrl}/${archiveName}`)
const checksum = (await download(`${baseUrl}/${archiveName}.sha256`)).toString('utf-8').trim().split(/\s+/)[0]
const actual = createHash('sha256').update(archive).digest('hex')
if (checksum !== actual) {
  console.error(`Checksum mismatch for ${archiveName}: expected ${checksum}, got ${actual}`)
  process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'datus-uv-'))
try {
  const archivePath = join(workDir, archiveName)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(archivePath, archive)
  execFileSync('tar', ['-xf', archivePath, '-C', workDir], { stdio: 'inherit' })
  const extracted = join(workDir, `uv-${triple}`, binaryName)
  if (!existsSync(extracted)) throw new Error(`Extracted binary missing: ${extracted}`)
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(extracted, outputBinary)
  if (process.platform !== 'win32') chmodSync(outputBinary, 0o755)
  console.log(`uv ${version} installed at ${outputBinary}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
