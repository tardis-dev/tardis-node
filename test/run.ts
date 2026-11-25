import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const files = readdirSync('test')
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => `test/${file}`)

const isolated = files.filter((file) => readFileSync(file, 'utf8').includes('mock.module'))
const shared = files.filter((file) => !isolated.includes(file))
const extraArgs = process.argv.slice(2)
const baseArgs = ['--experimental-test-module-mocks', '--import', './test/instant-waits.ts', '--test', ...extraArgs]

const run = (args: string[]) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })

const codes = await Promise.all([
  shared.length > 0 ? run([...baseArgs, '--test-isolation=none', ...shared]) : 0,
  isolated.length > 0 ? run([...baseArgs, '--test-concurrency=4', ...isolated]) : 0
])

process.exit(codes.find((code) => code !== 0) ?? 0)
