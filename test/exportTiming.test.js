import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordRun, estimateSeconds, formatEstimate } from '../src/domain/exportTiming.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) }
}

test('no history means no estimate', () => {
  const s = memoryStorage()
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 3600 }), null)
})

test('scales the last run to the new length: 1 h took 43 s, 9 h is about 6.5 min', () => {
  const s = memoryStorage()
  recordRun(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 3600, tookSeconds: 43 })
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 9 * 3600 }), 43 * 9)
})

test('uses the median of the last three runs and is per preset and output kind', () => {
  const s = memoryStorage()
  for (const took of [100, 10, 40, 50]) recordRun(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 100, tookSeconds: took })
  // kept 10, 40, 50 -> median 40
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 100 }), 40)
  assert.equal(estimateSeconds(s, { presetId: 'b', videoMode: 'audio-only', outputSeconds: 100 }), null)
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'both', outputSeconds: 100 }), null)
})

test('ignores unmeasurable runs and corrupt storage', () => {
  const s = memoryStorage()
  recordRun(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 0, tookSeconds: 5 })
  recordRun(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 60, tookSeconds: 0.2 })
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 60 }), null)
  s.setItem('noctivago-export:timing', '{nope')
  assert.equal(estimateSeconds(s, { presetId: 'a', videoMode: 'audio-only', outputSeconds: 60 }), null)
})

test('formats rounded text', () => {
  assert.equal(formatEstimate(43), 'about 45 s')
  assert.equal(formatEstimate(2), 'about 5 s')
  assert.equal(formatEstimate(12 * 60 + 20), 'about 12 min')
  assert.equal(formatEstimate(3600), 'about 1 h')
  assert.equal(formatEstimate(4800), 'about 1 h 20 min')
  assert.equal(formatEstimate(null), '')
})
