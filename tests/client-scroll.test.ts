import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const viewSource = readFileSync(new URL('../src/client/AutomationView.tsx', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

test('every Automation view state opts into the fixed-height composer-overlay host', () => {
  const roots = viewSource.match(/data-conversation-composer-overlay=""/g) ?? []
  assert.equal(roots.length, 3, 'loading, error, and ready roots must all declare the host overlay contract')

  const shellRule = styleSource.match(/\.dsh-automation-shell\{([^}]+)\}/)?.[1]
  assert.ok(shellRule, 'the Automation shell rule must exist')
  assert.match(shellRule, /(?:^|;)height:100%(?:;|$)/)
  assert.match(shellRule, /(?:^|;)min-height:0(?:;|$)/)
  assert.match(shellRule, /(?:^|;)overflow:auto(?:;|$)/)
  assert.match(shellRule, /(?:^|;)overscroll-behavior:contain(?:;|$)/)
})
