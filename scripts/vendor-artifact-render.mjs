#!/usr/bin/env node
// Vendors the @datus/web-artifact-render UMD bundle used by report/dashboard viewers.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = process.env.ARTIFACT_RENDER_VERSION || '2.0.0'
const outputDir = join(root, 'resources/artifact-render')
const workDir = mkdtempSync(join(tmpdir(), 'datus-artifact-'))

try {
  execFileSync('npm', ['pack', `@datus/web-artifact-render@${version}`, '--pack-destination', workDir], {
    stdio: 'inherit'
  })
  const tarball = readdirSync(workDir).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack produced no tarball')
  execFileSync('tar', ['-xzf', join(workDir, tarball), '-C', workDir], { stdio: 'inherit' })

  const dist = join(workDir, 'package', 'dist')
  const js = join(dist, 'index.umd.js')
  const css = join(dist, 'index.css')
  if (!existsSync(js) || !existsSync(css)) {
    throw new Error(`Unexpected package layout: expected ${js} and ${css}`)
  }
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(js, join(outputDir, 'index.umd.js'))
  copyFileSync(css, join(outputDir, 'index.css'))
  console.log(`Vendored @datus/web-artifact-render@${version} into ${outputDir}`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
