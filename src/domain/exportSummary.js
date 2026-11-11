// What the Export summary card says before you press Export: the file type
// and, where the bitrate is fixed, about how big it will be. Bytes per second
// match the app's final encode (exportMix.js): WAV is 16-bit stereo at
// 44.1 kHz, MP3 and Ogg 192k, Opus 128k. FLAC depends on the audio, so it
// gets no estimate.

export const FORMAT_LABELS = { wav: 'WAV', flac: 'FLAC', mp3: 'MP3', opus: 'Opus', ogg: 'Ogg Vorbis' }

const BYTES_PER_SECOND = { wav: 44100 * 2 * 2, mp3: 192000 / 8, opus: 128000 / 8, ogg: 192000 / 8 }

export function estimateBytes(format, seconds) {
  const rate = BYTES_PER_SECOND[format]
  if (!rate || !(seconds > 0)) return null
  return rate * seconds
}

// Decimal units, like Explorer's size column rounds them for a quick read.
export function formatBytes(bytes) {
  if (bytes == null) return ''
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

// "WAV, about 635 MB" / "FLAC" / "Video (MKV)" / "WAV + video (MKV)".
export function describeFile({ format, seconds, videoMode }) {
  if (videoMode === 'video-only') return 'Video (MKV)'
  const name = FORMAT_LABELS[format] ?? String(format).toUpperCase()
  const size = estimateBytes(format, seconds)
  const audio = size ? `${name}, about ${formatBytes(size)}` : name
  return videoMode === 'both' ? `${audio} + video (MKV)` : audio
}
