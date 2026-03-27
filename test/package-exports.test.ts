import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('package exports', () => {
  test('supports ESM named imports', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tardis-node-package-'))
    const packageDir = path.join(tempDir, 'node_modules', 'tardis-dev')

    mkdirSync(packageDir, { recursive: true })
    cpSync(path.join(repoRoot, 'package.json'), path.join(packageDir, 'package.json'))
    cpSync(path.join(repoRoot, 'dist'), path.join(packageDir, 'dist'), { recursive: true })
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(packageDir, 'node_modules'), 'dir')

    writeFileSync(
      path.join(tempDir, 'import-test.mjs'),
      `
        import * as tardis from 'tardis-dev'
        import { replay, stream } from 'tardis-dev'
        console.log(JSON.stringify({
          namespaceReplay: typeof tardis.replay,
          namespaceStream: typeof tardis.stream,
          hasDefault: Object.prototype.hasOwnProperty.call(tardis, 'default'),
          namedReplay: typeof replay,
          namedStream: typeof stream
        }))
      `.trim() + '\n'
    )

    const importOutput = JSON.parse(
      execFileSync(process.execPath, [path.join(tempDir, 'import-test.mjs')], {
        cwd: tempDir,
        encoding: 'utf8'
      })
    )

    expect(importOutput).toEqual({
      namespaceReplay: 'function',
      namespaceStream: 'function',
      hasDefault: false,
      namedReplay: 'function',
      namedStream: 'function'
    })

    rmSync(tempDir, { force: true, recursive: true })
  })
})
