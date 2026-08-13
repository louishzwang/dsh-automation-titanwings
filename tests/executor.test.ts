import assert from 'node:assert/strict'
import test from 'node:test'
import { unattendedToolGuardReason } from '../src/executor.ts'

test('unattended tool guard blocks interaction, delegation, and background process escape', () => {
  assert.match(unattendedToolGuardReason('ask_user_question', {}) ?? '', /allowlist/)
  assert.match(unattendedToolGuardReason('subagent', {}) ?? '', /allowlist/)
  assert.match(unattendedToolGuardReason('cordis_mount', {}) ?? '', /allowlist/)
  assert.match(unattendedToolGuardReason('automation_create', {}) ?? '', /allowlist/)
  assert.match(unattendedToolGuardReason('bash', { run_in_background: true }) ?? '', /Background/)
})

test('unattended tool guard preserves foreground coding and read tools', () => {
  assert.equal(unattendedToolGuardReason('read', { path: 'README.md' }), undefined)
  assert.equal(unattendedToolGuardReason('edit', { path: 'README.md' }), undefined)
  assert.equal(unattendedToolGuardReason('bash', { command: 'pnpm test' }), undefined)
  assert.equal(unattendedToolGuardReason('web_search', { query: 'package docs' }), undefined)
  assert.match(unattendedToolGuardReason('third_party_side_effect', {}) ?? '', /allowlist/)
})
