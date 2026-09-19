// Export length and time labels. No DOM.

// Duplicated from src/renderer/core/ (well, plugins/editor/util/time.js's own
// duplicate of it) - same cross-directory-import reason every other plugin
// duplication in this codebase has.
export function parseDuration(text) {
  const parts = text.trim().split(':')
  if (parts.length === 0 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null
  if (nums.length === 1) return nums[0]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  return nums[0] * 3600 + nums[1] * 60 + nums[2]
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '--:--:--'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Compact duration for filenames ("9h", "1h30m", "45s") - formatDuration's
// hh:mm:ss reads fine on-screen but ":" is an illegal Windows filename
// character, and "9:00:00" is a noisier label than the plain "9h" the inbox
// request itself used as an example. Omits zero components instead of
// padding them, so the common round-number case stays short.
export function formatDurationCompact(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)
  return parts.join('')
}
