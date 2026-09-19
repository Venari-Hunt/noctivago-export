import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateEvents } from '../src/domain/simulate.js'

describe('per-play pan in the export simulation', () => {
  const entry = { playMode: 'scatter', loopStart: 0, loopEnd: 1, scatter: { minGapSeconds: 1, maxGapSeconds: 2, minPan: -0.5, maxPan: 0.25 } }

  test('every event carries a pan inside the range', () => {
    const events = simulateEvents({ entry, durationSeconds: 300 })
    assert.ok(events.length > 50)
    assert.ok(events.every((e) => e.panPosition >= -0.5 && e.panPosition <= 0.25))
    assert.ok(new Set(events.map((e) => e.panPosition.toFixed(3))).size > 10)
  })

  test('no pan range -> every event centered', () => {
    const events = simulateEvents({ entry: { ...entry, scatter: { minGapSeconds: 1, maxGapSeconds: 2 } }, durationSeconds: 60 })
    assert.ok(events.every((e) => e.panPosition === 0))
  })

  test('fully random volume stays within 0..1 and varies', () => {
    const events = simulateEvents({ entry: { ...entry, scatter: { minGapSeconds: 1, maxGapSeconds: 2, volumeFullyRandom: true } }, durationSeconds: 300 })
    assert.ok(events.every((e) => e.volumeScale >= 0 && e.volumeScale <= 1))
    assert.ok(Math.max(...events.map((e) => e.volumeScale)) - Math.min(...events.map((e) => e.volumeScale)) > 0.5)
  })
})
