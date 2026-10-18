// The Export tab's remembered choices that the app's settings store has no
// setter for (export kind, length, format, fades). Kept in the renderer's
// localStorage under one key; anything missing or invalid falls back to the
// default, so a corrupt or old entry never breaks the tab.

export const PREFS_KEY = 'noctivago-export:prefs'

export const EXPORT_KINDS = ['file', 'phone']
export const FILE_FORMATS = ['wav', 'mp3', 'opus', 'flac', 'ogg']

export const DEFAULT_PREFS = { kind: 'file', length: '1:00:00', format: 'wav', fadeIn: 2, fadeOut: 2 }

const validFade = (value, fallback) => (typeof value === 'number' && value >= 0 && value <= 60 ? value : fallback)

export function normalizePrefs(raw) {
  const prefs = raw && typeof raw === 'object' ? raw : {}
  return {
    kind: EXPORT_KINDS.includes(prefs.kind) ? prefs.kind : DEFAULT_PREFS.kind,
    length: typeof prefs.length === 'string' && prefs.length ? prefs.length : DEFAULT_PREFS.length,
    format: FILE_FORMATS.includes(prefs.format) ? prefs.format : DEFAULT_PREFS.format,
    fadeIn: validFade(prefs.fadeIn, DEFAULT_PREFS.fadeIn),
    fadeOut: validFade(prefs.fadeOut, DEFAULT_PREFS.fadeOut)
  }
}

export function readPrefs(storage) {
  try {
    return normalizePrefs(JSON.parse(storage.getItem(PREFS_KEY)))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(storage, prefs) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(prefs)))
  } catch {
    // Storage full or blocked: the choice just isn't remembered.
  }
}

// Which preset the picker starts on: the one loaded in the Mixer, else the
// one picked last time, else the first.
export function pickDefaultPresetId(presets, activePresetId, previousId) {
  if (presets.some((p) => p.id === activePresetId)) return activePresetId
  if (presets.some((p) => p.id === previousId)) return previousId
  return presets[0]?.id ?? ''
}
