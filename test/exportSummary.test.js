import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateBytes, formatBytes, describeFile } from '../src/domain/exportSummary.js'

test('an hour of WAV is about 635 MB, as the mock says', () => {
  assert.equal(formatBytes(estimateBytes('wav', 3600)), '635 MB')
  assert.equal(describeFile({ format: 'wav', seconds: 3600, videoMode: 'audio-only' }), 'WAV, about 635 MB')
})

test('lossy formats use the encode bitrate; FLAC gets no estimate', () => {
  assert.equal(formatBytes(estimateBytes('mp3', 3600)), '86 MB')
  assert.equal(formatBytes(estimateBytes('opus', 60)), '960 KB')
  assert.equal(estimateBytes('flac', 3600), null)
  assert.equal(describeFile({ format: 'flac', seconds: 3600, videoMode: 'audio-only' }), 'FLAC')
  assert.equal(formatBytes(estimateBytes('wav', 9 * 3600)), '5.7 GB')
})

test('video modes name the MKV', () => {
  assert.equal(describeFile({ format: 'wav', seconds: 60, videoMode: 'video-only' }), 'Video (MKV)')
  assert.equal(describeFile({ format: 'mp3', seconds: 60, videoMode: 'both' }), 'MP3, about 1 MB + video (MKV)')
})
