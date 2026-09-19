import { routeDevAudioOutput } from './devAudioOutput.js'


// Inbox request: "When export finishes it should beep or make a sound or
// something" - an export can run for minutes to hours (see exportMix.js's
// own benchmarks), long enough that the owner isn't necessarily watching the
// tab when it lands. A short two/three-note chime (rising = success, falling
// = failure, so the two are distinguishable without looking) via a throwaway
// AudioContext + a couple of OscillatorNodes - no bundled sound asset needed,
// and this app already builds everything audio-related on Web Audio anyway.
// The context is closed a beat after the last note finishes rather than left
// open indefinitely. routeDevAudioOutput mirrors the same dev-mode
// convenience every other AudioContext in this codebase gets (routes to the
// monitor-out device instead of the PC speakers while developing) - a
// throwaway completion beep is exactly the kind of dev-testing noise that
// convenience exists to avoid.
export function playCompletionChime(success) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    routeDevAudioOutput(ctx)
    const now = ctx.currentTime
    const notes = success ? [523.25, 659.25, 783.99] : [392.0, 293.66]
    const noteLength = 0.14
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * noteLength
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteLength)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + noteLength + 0.02)
    })
    setTimeout(() => ctx.close().catch(() => {}), (notes.length * noteLength + 0.3) * 1000)
  } catch (err) {
    console.error('Export: completion chime failed', err)
  }
}
