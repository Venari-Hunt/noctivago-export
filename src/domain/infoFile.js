import { formatDuration } from './duration.js'

// Short filename-friendly video-kind label, alongside buildInfoFileText's
// longer prose version of the same choice - same source data
// (videoBackground + visualization type), different destination (a file
// basename component vs. a sentence in info.txt).
export function videoKindFileLabel(videoBackground, visualizationType) {
  if (videoBackground === 'file') return 'Looped video'
  if (videoBackground === 'image') return 'Looped image'
  if (videoBackground === 'visualization') {
    const type = String(visualizationType ?? 'waveform')
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} viz`
  }
  return 'Black screen'
}

export const VIDEO_MODE_LABELS = {
  'audio-only': 'Audio only',
  'video-only': 'Video only (for YouTube) - a .mkv with the audio muxed inside',
  both: 'Audio + video (a standalone audio file and a .mkv, both with the same audio)'
}

// Raw material for a YouTube/social description, not a finished one - plain
// facts about what was exported (inbox: "export an info file... to help
// populate an AI-written YouTube/social description"). Built in the renderer
// (has the preset/library data already in memory) and handed to
// export:writeInfoFile as a plain string, since the renderer has no direct
// fs access - see ipc.js's own comment on that handler.
// The AI prompt at the bottom of info.txt. Owner-editable from the Export tab
// (settings.exportInfoPrompt); a blank field falls back to this default, so
// clearing the box is how you get it back.
export const DEFAULT_INFO_PROMPT =
  'This ambient mix was made with Noctívago, a desktop ambient sound mixer for Windows ' +
  '(https://venar1.itch.io/noctivago). Using the ambient mix details above, write everything needed to ' +
  'upload this as a YouTube video: (1) a title under 100 characters, (2) a 2-3 paragraph description ' +
  'mentioning the mood/setting and the included sounds (use "How the scene is set up" to describe what the ' +
  'listener hears, in plain words, without technical terms), followed by the Credits section above copied ' +
  'exactly as written, then one short line saying the mix was made with Noctívago (include the link above), ' +
  'then 3-5 hashtags to close the description with, written for people searching for ' +
  'ambient/relaxing/sleep/focus audio, and (3) a list of 10-15 relevant YouTube tags (comma-separated).'

export function buildInfoFileText({ presetName, durationSeconds, format, videoMode, videoBackground, loopVideoName, imageName, imageMotion, visualizationSummary, soundInfoList, fadeInSeconds, fadeOutSeconds, sceneLines, creditLines, prompt }) {
  const lines = [presetName, '']
  lines.push(`Length: ${formatDuration(durationSeconds)}`)
  lines.push(`Format: ${String(format).toUpperCase()}`)
  lines.push(`Output: ${VIDEO_MODE_LABELS[videoMode] ?? videoMode}`)
  if (videoMode !== 'audio-only') {
    const videoDesc =
      videoBackground === 'file' && loopVideoName
        ? `looping "${loopVideoName}"`
        : videoBackground === 'image' && imageName
          ? `looping "${imageName}"${imageMotion && imageMotion !== 'none' ? ` (${imageMotion})` : ''}`
          : videoBackground === 'visualization'
            ? visualizationSummary
            : 'flat black screen'
    lines.push(`Video: ${videoDesc}`)
  }
  lines.push(`Fade in / out: ${fadeInSeconds}s / ${fadeOutSeconds}s`)
  lines.push('')
  lines.push(`Sounds included (${soundInfoList.length}):`)
  for (const s of soundInfoList) {
    lines.push(`- ${s.name}${s.tags.length ? ` — tags: ${s.tags.join(', ')}` : ''}`)
  }
  // v0.1.224 (owner inbox): what the mix actually does, and who to credit.
  if (sceneLines?.length) lines.push('', ...sceneLines)
  if (creditLines?.length) lines.push('', ...creditLines)
  // Direct follow-up (2026-09-05 inbox, after trying the plain file): "maybe
  // already put a prompt inside it that will return the text needed for
  // every field of a youtube video." The facts above are the raw material;
  // this is a ready-to-paste prompt that turns them into an actual
  // title/description/tags, so there's no separate step of figuring out what
  // to ask an AI for.
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('Paste this whole file into an AI assistant to get a ready-to-use YouTube upload:')
  lines.push('')
  lines.push(prompt?.trim() || DEFAULT_INFO_PROMPT)
  return lines.join('\n')
}
