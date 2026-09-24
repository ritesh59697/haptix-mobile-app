/**
 * `EXPO_PUBLIC_*` values must be read as literal member expressions.
 *
 * Expo substitutes these at bundle time by matching the source text, so
 * `process.env.EXPO_PUBLIC_FOO` becomes the value and `process.env[SOME_CONST]` is left
 * alone. Nothing catches the difference in development, because the Metro dev server
 * also populates a real `process.env` from `.env`. A release build has no runtime
 * `process.env`, so the computed form reads `undefined` only in the binary.
 *
 * That is not hypothetical: `utils/haptix-funder.ts` used `process.env[FUNDER_KEY_ENV]`,
 * which made fee sponsorship work in Expo Go and report the key as unset in the shipped
 * APK, where tapping "Finish setup" was the first thing a user would try.
 *
 * This suite holds the invariant from both sides: no computed access anywhere in the
 * bundle's source, and the specific reads the app depends on still spelled literally.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.error(`  FAIL: ${name}`)
    if (detail) console.error(`        Detail: ${detail}`)
    failed++
  }
}

/** Directories whose output is bundled for the device. `tools/` and `tests/` run under
 *  Node, where `process.env` is a real object and computed access is correct. */
const BUNDLED_DIRS = ['app', 'components', 'utils', 'constants', 'hooks']
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path))
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      files.push(path)
    }
  }
  return files
}

const offenders: string[] = []

for (const dir of BUNDLED_DIRS) {
  for (const file of sourceFiles(dir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      // Skip comment-only lines so prose explaining the rule does not trip it.
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
      if (/process\.env\[/.test(line)) {
        offenders.push(`${file}:${index + 1}  ${trimmed}`)
      }
    })
  }
}

assert(
  offenders.length === 0,
  'no bundled source reads process.env with a computed key',
  offenders.length > 0 ? `\n        ${offenders.join('\n        ')}` : undefined,
)

/** The reads that must stay literal, named individually so a rename cannot quietly
 *  drop one from the scan above. */
const REQUIRED_LITERAL_READS: [string, string][] = [
  ['utils/haptix-funder.ts', 'process.env.EXPO_PUBLIC_HAPTIX_FUNDER_KEY'],
  ['constants/app-config.ts', 'process.env.EXPO_PUBLIC_HAPTIX_DEV_MODE'],
  ['utils/rpc-endpoints.ts', 'process.env.EXPO_PUBLIC_HAPTIX_DEVNET_RPC_URL'],
  ['utils/rpc-endpoints.ts', 'process.env.EXPO_PUBLIC_HAPTIX_MAINNET_RPC_URL'],
]

for (const [file, expression] of REQUIRED_LITERAL_READS) {
  assert(readFileSync(file, 'utf8').includes(expression), `${file} reads ${expression.split('.').pop()} literally`)
}

console.log(`\n  ENV INLINING TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}\n`)
if (failed > 0) process.exit(1)
