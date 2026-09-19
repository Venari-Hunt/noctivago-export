import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDuration, formatDuration, formatDurationCompact } from '../src/domain/duration.js'
import { applySoundOverride } from '../src/domain/soundOverride.js'
import { videoKindFileLabel } from '../src/domain/infoFile.js'

test('parseDuration reads s, m:s and h:m:s', () => {
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('1:30'), 90)
  assert.equal(parseDuration('2:00:05'), 7205)
  assert.equal(parseDuration('x'), null)
  assert.equal(parseDuration('1:2:3:4'), null)
})

test('formatDuration and formatDurationCompact', () => {
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(NaN), '--:--:--')
  assert.equal(formatDurationCompact(9 * 3600), '9h')
  assert.equal(formatDurationCompact(5400), '1h30m')
  assert.equal(formatDurationCompact(0), '0s')
})

test('applySoundOverride only applies overridable keys', () => {
  const entry = { id: 'a', volume: 1, loopStart: 0 }
  assert.equal(applySoundOverride(entry, null), entry)
  assert.deepEqual(applySoundOverride(entry, { loopStart: 2, volume: 0.1 }), { id: 'a', volume: 1, loopStart: 2 })
})

test('videoKindFileLabel', () => {
  assert.equal(videoKindFileLabel('file'), 'Looped video')
  assert.equal(videoKindFileLabel('visualization', 'spectrum'), 'Spectrum viz')
  assert.equal(videoKindFileLabel('none'), 'Black screen')
})
