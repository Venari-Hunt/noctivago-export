// "About how long will this take", shown in the summary card before Export.
//
// The engine cannot predict it from the settings: the cost depends on how many
// plays the sounds make, pitch, drift and group processing (see the app's
// export-perf notes), and a short probe run would itself cost minutes. What it
// can do is learn: every finished export records how many seconds of work each
// second of output took, per preset and output kind, and the next estimate
// scales the median of the last few runs to the new length. No history for a
// preset means no estimate (the card says nothing rather than guess).

export const TIMING_KEY = 'noctivago-export:timing'
const KEEP_RUNS = 3

const keyFor = (presetId, videoMode) => `${presetId}|${videoMode === 'audio-only' ? 'audio' : 'video'}`

function readAll(storage) {
  try {
    const all = JSON.parse(storage.getItem(TIMING_KEY))
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch {
    return {}
  }
}

// Called after a successful export. Ignores runs too short to measure.
export function recordRun(storage, { presetId, videoMode, outputSeconds, tookSeconds }) {
  if (!presetId || !(outputSeconds > 0) || !(tookSeconds >= 1)) return
  try {
    const all = readAll(storage)
    const key = keyFor(presetId, videoMode)
    const runs = Array.isArray(all[key]) ? all[key] : []
    all[key] = [...runs, tookSeconds / outputSeconds].filter((r) => Number.isFinite(r) && r > 0).slice(-KEEP_RUNS)
    storage.setItem(TIMING_KEY, JSON.stringify(all))
  } catch {
    // Storage full or blocked: no estimate next time.
  }
}

// Seconds the export is expected to take, or null with no history.
export function estimateSeconds(storage, { presetId, videoMode, outputSeconds }) {
  if (!presetId || !(outputSeconds > 0)) return null
  const runs = readAll(storage)[keyFor(presetId, videoMode)]
  if (!Array.isArray(runs) || runs.length === 0) return null
  const sorted = runs.filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  const ratio = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return ratio * outputSeconds
}

// "about 45 s", "about 12 min", "about 1 h 20 min": rounded, since it is a guess.
export function formatEstimate(seconds) {
  if (seconds == null || !(seconds > 0)) return ''
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `about ${h} h ${m} min` : `about ${h} h`
}
