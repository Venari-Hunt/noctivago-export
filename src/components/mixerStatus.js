// Asks the Mixer which preset is loaded, over the same synchronous window
// event the Remix plugin uses (tabs/mixer/index.js answers
// `noctivago:request-mixer-status`). Null when nothing is loaded or the
// Mixer doesn't answer.
export function requestActivePresetId() {
  const detail = { activePresetId: null, isPlaying: false, soloedGroupId: null }
  window.dispatchEvent(new CustomEvent('noctivago:request-mixer-status', { detail }))
  return detail.activePresetId
}
