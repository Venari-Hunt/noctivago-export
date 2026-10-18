import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPrefs, writePrefs, normalizePrefs, pickDefaultPresetId, DEFAULT_PREFS, PREFS_KEY } from '../src/domain/exportPrefs.js'

const memoryStorage = () => {
  const data = new Map()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) }
}

test('readPrefs falls back to defaults when empty or corrupt', () => {
  const storage = memoryStorage()
  assert.deepEqual(readPrefs(storage), DEFAULT_PREFS)
  storage.setItem(PREFS_KEY, '{not json')
  assert.deepEqual(readPrefs(storage), DEFAULT_PREFS)
})

test('writePrefs then readPrefs round-trips the choices', () => {
  const storage = memoryStorage()
  const prefs = { kind: 'phone', length: '9:00:00', format: 'mp3', fadeIn: 0, fadeOut: 5 }
  writePrefs(storage, prefs)
  assert.deepEqual(readPrefs(storage), prefs)
})

test('normalizePrefs drops invalid fields one by one', () => {
  assert.deepEqual(normalizePrefs({ kind: 'tape', format: 'phone', fadeIn: -1, fadeOut: 2.5, length: '' }), {
    ...DEFAULT_PREFS,
    fadeOut: 2.5
  })
})

test('readPrefs and writePrefs survive a storage that throws', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(readPrefs(broken), DEFAULT_PREFS)
  assert.doesNotThrow(() => writePrefs(broken, DEFAULT_PREFS))
})

test('pickDefaultPresetId prefers the Mixer preset, then the last pick, then the first', () => {
  const presets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(pickDefaultPresetId(presets, 'c', 'b'), 'c')
  assert.equal(pickDefaultPresetId(presets, null, 'b'), 'b')
  assert.equal(pickDefaultPresetId(presets, 'gone', 'gone'), 'a')
  assert.equal(pickDefaultPresetId([], 'a', 'b'), '')
})
