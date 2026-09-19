// Per-preset sound overrides (planned 2026-09-12, "presets as primary
// context"): mirrors src/shared/constants.js's OVERRIDABLE_SOUND_KEYS/
// applySoundOverride exactly - same cross-directory duplication reason as
// parseDuration above. Keep in sync with core if that set ever changes.
// Without this, exporting a preset with per-sound overrides would silently
// bake the sound's shared baseline instead of what the Mixer actually
// plays for that preset - a correctness bug, not a cosmetic gap.
export const OVERRIDABLE_SOUND_KEYS = ['loopStart', 'loopEnd', 'filters', 'crossfadeSeconds', 'speedPitch', 'playMode', 'scatter', 'schedule']

export function applySoundOverride(entry, override) {
  if (!override) return entry
  const patch = {}
  for (const key of OVERRIDABLE_SOUND_KEYS) {
    if (override[key] !== undefined) patch[key] = override[key]
  }
  return { ...entry, ...patch }
}
