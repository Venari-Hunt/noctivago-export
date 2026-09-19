import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadCore } from './helpers/core.js'
import { applyGroupShotOverride } from '../src/domain/simulate.js'

test("credits.js matches the app's src/shared/credits.js", async (t) => {
  const core = await loadCore('src/shared/credits.js')
  if (!core) return t.skip('GitHub unreachable')
  const mine = fs.readFileSync(new URL('../src/domain/credits.js', import.meta.url), 'utf8')
  assert.equal(mine.split('\n').slice(2).join('\n'), core.text)
})

test("applyGroupShotOverride gives the same results as the app's src/shared/groupDrift.js", async (t) => {
  const core = await loadCore('src/shared/groupDrift.js')
  if (!core) return t.skip('GitHub unreachable')
  const timing = { changeMinSeconds: 2, changeMaxSeconds: 4, transitionSeconds: 1 }
  const axis = (extra) => ({ enabled: true, fullyRandom: false, biasEnabled: true, min: -0.4, max: 0.6, bias: 0.1, ...timing, ...extra })
  const scatter = { minGapSeconds: 5, minPitchSemitones: 3, maxPitchSemitones: 3, minVolume: 1, maxVolume: 1 }
  const cases = [
    null,
    { volume: axis({ perSound: true }) },
    { pitch: axis({ fullyRandom: true }), pan: axis({ perSound: true, bias: 5 }) },
    { volume: axis(), pan: axis() }
  ]
  for (const g of cases) assert.deepEqual(applyGroupShotOverride(scatter, g), core.module.applyGroupShotOverride(scatter, g))
})
