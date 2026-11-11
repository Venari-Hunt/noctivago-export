import { simulateEvents, applyGroupShotOverride } from '../domain/simulate.js'
import { buildSceneSection, buildCreditsSection } from '../domain/sceneSummary.js'
import { parseDuration, formatDuration, formatDurationCompact } from '../domain/duration.js'
import { applySoundOverride } from '../domain/soundOverride.js'
import { videoKindFileLabel, DEFAULT_INFO_PROMPT, buildInfoFileText } from '../domain/infoFile.js'
import { readPrefs, writePrefs, pickDefaultPresetId, DEFAULT_PREFS } from '../domain/exportPrefs.js'
import { describeFile, estimateBytes, formatBytes } from '../domain/exportSummary.js'
import { playCompletionChime } from './chime.js'
import { requestActivePresetId } from './mixerStatus.js'
import { icon } from './icons.js'

// Bakes a whole preset down to one audio file of a chosen length/format -
// its own tab (not just a Presets-modal button, per the owner's own explicit
// direction: "I think this should be a new plugin as in you go to the tab
// and there's settings on how you want it exported"). Design worked out
// collaboratively with the owner: simulate first (reusing the exact
// randomization/scheduling functions each playMode's real playback source
// already uses, run as a dry loop - see simulate.js), then hand the
// resulting event lists to a main-process ffmpeg pipeline that builds one
// track per included sound and mixes them down.
//
// Desktop 2.0 (step 16): the screen follows the approved mock's `export`,
// `export-video`, `export-phone`, `export-run` and `export-done` screens. A
// form column (type, preset, length, fade, output, format tiles, video card,
// options) beside a summary card that turns into the progress ring while an
// export runs and into the result when it ends.

const FORMATS = [['wav', 'WAV', 'Lossless'], ['flac', 'FLAC', 'Lossless, smaller'], ['mp3', 'MP3', 'Plays anywhere'], ['opus', 'Opus', 'Small'], ['ogg', 'Ogg Vorbis', 'Small, open']]
const OUTPUTS = [['audio-only', 'Audio only'], ['video-only', 'Video only'], ['both', 'Both']]
const VIDEO_KINDS = [['black', 'moon', 'Flat black screen', 'Fastest, near-instant'], ['file', 'file', 'Loop a video file', 'Choose video…'], ['image', 'eye', 'Loop an image', 'Choose image…'], ['visualization', 'audio-waveform', 'Visualization', 'Reacts to the audio']]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '')
const sw = (id, label) => `<button id="${id}" class="ex-sw" type="button" role="switch" aria-checked="false" aria-label="${label}"></button>`
const row = (title, sub, trail, attrs = '') => `<div class="ex-row" ${attrs}><div class="ex-sl"><span>${title}</span>${sub ? `<small>${sub}</small>` : ''}</div><div class="ex-trail">${trail}</div></div>`
const ring = (kids) => `<div class="ex-ring"><svg viewBox="0 0 72 72" aria-hidden="true"><circle class="ex-trk" cx="36" cy="36" r="31" pathLength="100"/><circle class="ex-val" cx="36" cy="36" r="31" pathLength="100"/></svg>${kids}</div>`

export default class ExportPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.presets = []
    this.library = []
    this.els = {}
    this.exporting = false
    this.view = 'form'
    this.steps = []
    this.logLines = []
    this.logOpen = false
    this.result = null
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'export',
      title: 'Export',
      mount: (container) => this.mount(container),
      onShow: () => this.refresh()
    })
  }

  async onunload() {
    this.stopElapsedTicker()
    this.unsubscribeProgress?.()
    this.unregister?.()
  }

  // Stamps how long the just-finished step actually took onto its log line
  // and its row in the steps list - see onExportProgress's own comment.
  closeLastLogLineTiming() {
    if (this.lastStepAt == null) return
    const seconds = (Date.now() - this.lastStepAt) / 1000
    const last = this.steps[this.steps.length - 1]
    if (last && last.took == null) {
      last.took = seconds
      this.logLines[last.logIndex] += ` (${formatDuration(seconds)})`
    }
    this.lastStepAt = null
  }

  onExportProgress(payload) {
    if (!this.exporting) return
    // Feeds the elapsed/ETA ticker below - the only other thing ffmpeg's
    // progress stream gives us is the same 0..1 fraction the ring already
    // shows, so an ETA is just elapsed * (remaining/done), no new plumbing.
    this.lastFraction = payload.fraction ?? this.lastFraction
    if (payload.type === 'step' && payload.label) {
      // Per-phase wall-clock timing (2026-09-02, Export Part B investigation):
      // surface how long each phase actually took, right in the log every
      // export already writes - the next real slow export shows where the
      // time goes. Each line also carries the real time it started
      // ("the logging on the export tab should be timestamped with real
      // time and the time it took to complete that step").
      this.closeLastLogLineTiming()
      this.lastStepAt = Date.now()
      this.logLines.push(`[${new Date().toLocaleTimeString()}] ${payload.label}`)
      this.steps.push({ label: payload.label, took: null, logIndex: this.logLines.length - 1 })
      this.renderSteps()
      this.renderLog()
    }
    this.renderProgress()
  }

  mount(container) {
    const tiles5 = FORMATS.map(([v, t, d]) => `<button type="button" data-format="${v}" aria-pressed="false"><b>${t}</b><span>${d}</span></button>`).join('')
    const tiles4 = VIDEO_KINDS.map(([v, ic, t, d]) => `<button type="button" data-vid="${v}" aria-pressed="false">${icon(ic, 20)}<b>${t}</b><span>${d}</span></button>`).join('')
    const outs = OUTPUTS.map(([v, t]) => `<button type="button" data-out="${v}" aria-pressed="false">${t}</button>`).join('')
    const select = (id, label, opts) => `<select id="${id}" class="ex-field ex-w224" aria-label="${label}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`
    container.innerHTML = `
      <div class="export-tab">
        <div class="ex-cols">
          <div class="ex-col">
            <div class="ex-card">
              <div class="ex-head">
                <div class="ex-seg" role="group" aria-label="Export type">
                  <button type="button" data-kind="file" aria-pressed="false">Audio or video</button>
                  <button type="button" data-kind="phone" aria-pressed="false">For phone</button>
                </div>
              </div>
              <p id="export-phone-hint" class="ex-prose" hidden>Saves a preset file for the Noctívago phone app. Every sound's Remix settings and all reverb are baked in, so the phone only mixes, and it plays for as long as you like.</p>
              ${row('Preset', '', '<select id="export-preset" class="ex-field ex-w224" aria-label="Preset"></select>')}
              <div id="export-file-options">
                ${row('Length', 'Plays the mix for real over this time, random sounds included', '<input id="export-length" class="ex-field ex-w96 ex-tc" type="text" inputmode="numeric" placeholder="hh:mm:ss" value="1:00:00" aria-label="Length" />')}
                ${row('Fade', 'In and out, seconds', '<input id="export-fade-in" class="ex-field ex-w64 ex-tc" type="number" min="0" max="60" step="0.5" value="2" aria-label="Fade in" /><input id="export-fade-out" class="ex-field ex-w64 ex-tc" type="number" min="0" max="60" step="0.5" value="2" aria-label="Fade out" />')}
                ${row('Output', 'Video only is for YouTube', `<div class="ex-seg ex-seg-in" role="group" aria-label="Output">${outs}</div>`)}
                <div id="export-formats" class="ex-tiles5" role="group" aria-label="Format">${tiles5}</div>
              </div>
            </div>

            <div id="export-video-card" class="ex-card" hidden>
              <h2 class="ex-gh">Video</h2>
              <div class="ex-tiles4" role="group" aria-label="Video">${tiles4}</div>
              <div id="export-video-file-section" hidden>
                ${row('Video to loop', '<span id="export-video-path">Nothing chosen yet</span>', '<button id="export-choose-video" class="ex-b" type="button">Choose video…</button><button id="export-clear-video" class="ex-b ex-ghost" type="button">Clear</button>')}
                <p class="ex-hint">Shorter than the export? It repeats from the start with a hard cut, so a video that already loops cleanly works best.</p>
              </div>
              <div id="export-image-section" hidden>
                ${row('Image', '<span id="export-image-path">Nothing chosen yet</span>', '<button id="export-choose-image" class="ex-b" type="button">Choose image…</button><button id="export-clear-image" class="ex-b ex-ghost" type="button">Clear</button>')}
                ${row('Motion', 'Fades in and out with the audio', select('export-image-motion', 'Motion', [['none', 'None (static)'], ['spin', 'Spin'], ['bounce', 'DVD bounce']]))}
              </div>
              <div id="export-viz-section" hidden>
                ${row('Style', '', select('export-viz-type', 'Style', [['waveform', 'Waveform'], ['spectrum', 'Spectrum'], ['vectorscope', 'Vectorscope']]))}
                <div id="export-viz-palette-row" hidden>${row('Palette', '', select('export-viz-palette', 'Palette', [['intensity', 'Intensity'], ['rainbow', 'Rainbow'], ['fire', 'Fire'], ['magma', 'Magma'], ['cool', 'Cool'], ['moreland', 'Moreland']]))}</div>
                <div id="export-viz-color-row">${row('Color', '', '<input id="export-viz-color" type="color" class="ex-colorpick" value="#9ece6a" aria-label="Color" />')}</div>
                ${row('Background', 'Black renders fastest', '<input id="export-viz-bg-color" type="color" class="ex-colorpick" value="#000000" aria-label="Background" />')}
                ${row('Size', '', select('export-viz-size', 'Size', [['small', 'Small (854×480)'], ['medium', 'Medium (1280×720)'], ['large', 'Large (1920×1080)']]))}
                ${row('Frame rate', 'Higher is smoother and slower', select('export-viz-fps', 'Frame rate', [['15', '15 fps (fastest)'], ['30', '30 fps'], ['60', '60 fps (smoothest)']]))}
              </div>
            </div>

            <div id="export-options-card" class="ex-card">
              <h2 class="ex-gh">Options</h2>
              ${row('Faster export', 'Uses more CPU and memory. Turn off to keep working while it runs.', sw('export-faster', 'Faster export'))}
              ${row('Info file', 'Name, length and sounds, ready for a video description', sw('export-info-file', 'Info file'))}
              <div id="export-info-prompt-wrap" hidden>
                ${row('Info file prompt', '<span id="export-info-prompt-state">Default</span>', icon('chevron-right'), 'id="export-info-prompt-toggle" class="ex-row ex-click" role="button" tabindex="0" aria-expanded="false"')}
                <div id="export-info-prompt-row" hidden>
                  <textarea id="export-info-prompt" class="ex-field ex-ta" rows="6" aria-label="Info file prompt"></textarea>
                  <p class="ex-hint">The AI prompt at the end of the info file. Leave it empty for the default (shown faded).</p>
                </div>
              </div>
              ${row('Parallel mixdown', 'Experimental. More CPU, memory and disk.', sw('export-parallel-mixdown', 'Parallel mixdown'))}
            </div>
          </div>
          <div id="export-sum" class="ex-card ex-sum" aria-live="polite"></div>
        </div>
      </div>
    `

    const q = (s) => container.querySelector(s)
    this.els = {
      kindOptions: Array.from(container.querySelectorAll('[data-kind]')),
      outOptions: Array.from(container.querySelectorAll('[data-out]')),
      formatOptions: Array.from(container.querySelectorAll('[data-format]')),
      vidOptions: Array.from(container.querySelectorAll('[data-vid]')),
      phoneHint: q('#export-phone-hint'),
      fileOptions: q('#export-file-options'),
      formats: q('#export-formats'),
      preset: q('#export-preset'),
      length: q('#export-length'),
      faster: q('#export-faster'),
      parallelMixdown: q('#export-parallel-mixdown'),
      videoCard: q('#export-video-card'),
      optionsCard: q('#export-options-card'),
      videoFileSection: q('#export-video-file-section'),
      chooseVideo: q('#export-choose-video'),
      clearVideo: q('#export-clear-video'),
      videoPath: q('#export-video-path'),
      imageSection: q('#export-image-section'),
      chooseImage: q('#export-choose-image'),
      clearImage: q('#export-clear-image'),
      imagePath: q('#export-image-path'),
      imageMotion: q('#export-image-motion'),
      vizSection: q('#export-viz-section'),
      vizType: q('#export-viz-type'),
      vizColorRow: q('#export-viz-color-row'),
      vizColor: q('#export-viz-color'),
      vizPaletteRow: q('#export-viz-palette-row'),
      vizPalette: q('#export-viz-palette'),
      vizBgColor: q('#export-viz-bg-color'),
      vizSize: q('#export-viz-size'),
      vizFps: q('#export-viz-fps'),
      infoFile: q('#export-info-file'),
      infoPromptWrap: q('#export-info-prompt-wrap'),
      infoPromptToggle: q('#export-info-prompt-toggle'),
      infoPromptState: q('#export-info-prompt-state'),
      infoPromptRow: q('#export-info-prompt-row'),
      infoPrompt: q('#export-info-prompt'),
      fadeIn: q('#export-fade-in'),
      fadeOut: q('#export-fade-out'),
      sum: q('#export-sum')
    }

    this.unsubscribeProgress?.()
    this.unsubscribeProgress = this.api.export.onProgress((payload) => this.onExportProgress(payload))
    // Kind, length, format and fades are remembered between exports (the
    // other fields already persist through the app's settings store).
    const prefs = readPrefs(localStorage)
    this.els.length.value = prefs.length
    this.format = prefs.format
    this.els.fadeIn.value = String(prefs.fadeIn)
    this.els.fadeOut.value = String(prefs.fadeOut)
    this.videoMode = 'audio-only'
    this.videoBackground = 'black'
    this.setKind(prefs.kind)
    this.setFormat(prefs.format)
    this.setVideoMode('audio-only')
    this.setVideoBackground('black')

    for (const option of this.els.kindOptions) {
      option.addEventListener('click', () => {
        this.setKind(option.dataset.kind)
        this.savePrefs()
      })
    }
    for (const option of this.els.formatOptions) {
      option.addEventListener('click', () => {
        this.setFormat(option.dataset.format)
        this.savePrefs()
      })
    }
    for (const option of this.els.outOptions) {
      option.addEventListener('click', () => {
        this.setVideoMode(option.dataset.out)
        this.api.settings.setExportVideoMode(option.dataset.out)
      })
    }
    for (const option of this.els.vidOptions) {
      option.addEventListener('click', () => {
        this.setVideoBackground(option.dataset.vid)
        this.api.settings.setExportVideoBackground(option.dataset.vid)
      })
    }
    for (const field of [this.els.fadeIn, this.els.fadeOut]) {
      field.addEventListener('change', () => this.savePrefs())
    }
    this.els.preset.addEventListener('change', () => this.renderSummary())
    this.els.length.addEventListener('blur', () => this.normalizeLengthField())
    this.els.length.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') this.els.length.blur()
    })

    // "Faster export" is a per-machine resource choice made right before an
    // export, so it lives here rather than in the global Settings modal - but
    // it's still persisted (via the same settings store the export:run handler
    // reads) so the last choice sticks between sessions.
    this.bindSwitch(this.els.faster, (on) => this.api.settings.setFasterExportEnabled(on))
    this.bindSwitch(this.els.parallelMixdown, (on) => this.api.settings.setParallelMixdownEnabled(on))
    this.bindSwitch(this.els.infoFile, (on) => {
      this.api.settings.setExportInfoFileEnabled(on)
      this.els.infoPromptWrap.hidden = !on
    })
    this.els.infoPrompt.placeholder = DEFAULT_INFO_PROMPT
    this.els.infoPrompt.addEventListener('change', () => {
      this.api.settings.setExportInfoPrompt(this.els.infoPrompt.value)
      this.updateInfoPromptState()
    })
    const togglePrompt = () => {
      const open = this.els.infoPromptRow.hidden
      this.els.infoPromptRow.hidden = !open
      this.els.infoPromptToggle.setAttribute('aria-expanded', String(open))
    }
    this.els.infoPromptToggle.addEventListener('click', togglePrompt)
    this.els.infoPromptToggle.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault()
        togglePrompt()
      }
    })

    // "Choose video…" opens a native file dialog (main-process only, no
    // direct fs access here); the picked path is persisted immediately by the
    // IPC handler itself, so this side only needs to update the display.
    this.els.chooseVideo.addEventListener('click', async () => {
      const filePath = await this.api.export.pickVideoFile()
      if (filePath) this.setLoopVideoPath(filePath)
    })
    this.els.clearVideo.addEventListener('click', async () => {
      await this.api.settings.setExportLoopVideoPath(null)
      this.setLoopVideoPath(null)
      // Clearing the file with nothing else chosen falls back to black at
      // render time regardless (see exportMix.js's renderVideoOutput) - make
      // the visible choice match what will actually render right away.
      this.setVideoBackground('black')
      await this.api.settings.setExportVideoBackground('black')
    })
    this.els.chooseImage.addEventListener('click', async () => {
      const filePath = await this.api.export.pickImageFile()
      if (filePath) this.setImagePath(filePath)
    })
    this.els.clearImage.addEventListener('click', async () => {
      await this.api.settings.setExportImagePath(null)
      this.setImagePath(null)
      this.setVideoBackground('black')
      await this.api.settings.setExportVideoBackground('black')
    })
    this.els.imageMotion.addEventListener('change', () => {
      this.api.settings.setExportImageMotion(this.els.imageMotion.value)
    })
    this.els.vizType.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ type: this.els.vizType.value })
      this.updateVizFieldVisibility()
    })
    this.els.vizColor.addEventListener('input', () => {
      this.api.settings.setExportVisualizationOptions({ color: this.els.vizColor.value })
    })
    this.els.vizPalette.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ palette: this.els.vizPalette.value })
    })
    this.els.vizBgColor.addEventListener('input', () => {
      this.api.settings.setExportVisualizationOptions({ bgColor: this.els.vizBgColor.value })
    })
    this.els.vizSize.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ size: this.els.vizSize.value })
    })
    this.els.vizFps.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ fps: Number(this.els.vizFps.value) })
    })

    // The summary card's buttons are redrawn per state, so one listener on
    // the card handles them all.
    this.els.sum.addEventListener('click', (evt) => {
      const btn = evt.target.closest('[data-act]')
      if (!btn) return
      const act = btn.dataset.act
      if (act === 'run') this.runExport()
      else if (act === 'copy-log') this.copyLogToClipboard(btn)
      else if (act === 'toggle-log') {
        this.logOpen = !this.logOpen
        this.renderSummary()
      } else if (act === 'again') {
        this.view = 'form'
        this.renderSummary()
      }
    })

    this.api.settings
      .get()
      .then((settings) => {
        this.setSwitch(this.els.faster, Boolean(settings.fasterExport))
        this.lastFolder = settings.lastExportFolder ?? null
        this.setSwitch(this.els.parallelMixdown, Boolean(settings.parallelMixdown))
        this.setSwitch(this.els.infoFile, Boolean(settings.exportInfoFile))
        this.els.infoPromptWrap.hidden = !settings.exportInfoFile
        this.els.infoPrompt.value = settings.exportInfoPrompt ?? ''
        this.updateInfoPromptState()
        this.setLoopVideoPath(settings.exportLoopVideoPath ?? null)
        this.setImagePath(settings.exportImagePath ?? null)
        this.els.imageMotion.value = settings.exportImageMotion ?? 'none'
        this.els.vizType.value = settings.exportVisualizationType ?? 'waveform'
        this.els.vizColor.value = settings.exportVisualizationColor ?? '#9ece6a'
        this.els.vizPalette.value = settings.exportVisualizationPalette ?? 'intensity'
        this.els.vizBgColor.value = settings.exportVisualizationBgColor ?? '#000000'
        this.els.vizSize.value = settings.exportVisualizationSize ?? 'medium'
        this.els.vizFps.value = String(settings.exportVisualizationFps ?? 15)
        this.setVideoMode(settings.exportVideoMode ?? 'audio-only')
        this.setVideoBackground(settings.exportVideoBackground ?? 'black')
        this.updateVizFieldVisibility()
      })
      .catch((err) => console.error('Export: failed to read settings', err))

    this.renderSummary()
    this.refresh().catch((err) => console.error('Export: failed to load presets/library', err))
  }

  bindSwitch(el, onChange) {
    el.addEventListener('click', () => {
      const on = el.getAttribute('aria-checked') !== 'true'
      this.setSwitch(el, on)
      onChange(on)
    })
  }

  setSwitch(el, on) {
    el.setAttribute('aria-checked', String(on))
  }

  isOn(el) {
    return el.getAttribute('aria-checked') === 'true'
  }

  updateInfoPromptState() {
    this.els.infoPromptState.textContent = this.els.infoPrompt.value.trim() ? 'Custom' : 'Default'
  }

  normalizeLengthField() {
    const seconds = parseDuration(this.els.length.value)
    this.els.length.value = seconds === null || seconds <= 0 ? DEFAULT_PREFS.length : formatDuration(seconds)
    this.savePrefs()
    this.renderSummary()
  }

  // The export kind is picked first: "For phone" hides everything that only
  // means something for a fixed-length file (length, format, fades, video,
  // info file, speed options).
  setKind(kind) {
    this.kind = kind
    const isPhone = kind === 'phone'
    for (const option of this.els.kindOptions) option.setAttribute('aria-pressed', String(option.dataset.kind === kind))
    this.els.fileOptions.hidden = isPhone
    this.els.phoneHint.hidden = !isPhone
    this.els.optionsCard.hidden = isPhone
    this.updateVideoCardVisibility()
    this.renderSummary()
  }

  setFormat(format) {
    this.format = format
    for (const option of this.els.formatOptions) option.setAttribute('aria-pressed', String(option.dataset.format === format))
    this.renderSummary()
  }

  // Video only drops the audio file, so the format tiles go with it (the
  // mock hides them too); the video card shows for Video only and Both.
  setVideoMode(mode) {
    this.videoMode = mode
    for (const option of this.els.outOptions) option.setAttribute('aria-pressed', String(option.dataset.out === mode))
    this.els.formats.hidden = mode === 'video-only'
    this.updateVideoCardVisibility()
    this.renderSummary()
  }

  updateVideoCardVisibility() {
    this.els.videoCard.hidden = this.kind === 'phone' || this.videoMode === 'audio-only'
  }

  // Only one of the three sub-sections (file picker / image picker /
  // visualization controls) is relevant at a time, matching which of the
  // four renderVideoOutput branches (exportMix.js) would actually run.
  setVideoBackground(mode) {
    this.videoBackground = mode
    for (const option of this.els.vidOptions) option.setAttribute('aria-pressed', String(option.dataset.vid === mode))
    this.els.videoFileSection.hidden = mode !== 'file'
    this.els.imageSection.hidden = mode !== 'image'
    this.els.vizSection.hidden = mode !== 'visualization'
  }

  savePrefs() {
    writePrefs(localStorage, {
      kind: this.kind,
      length: this.els.length.value,
      format: this.format,
      fadeIn: Number(this.els.fadeIn.value),
      fadeOut: Number(this.els.fadeOut.value)
    })
  }

  // Renderer has no Node `path` module (sandboxed, per this app's plugin
  // security model) - a plain basename split covers both Windows and POSIX
  // separators, which is all this display needs.
  setLoopVideoPath(filePath) {
    this.loopVideoPath = filePath || null
    this.els.videoPath.textContent = filePath ? `Looping ${baseName(filePath)}` : 'Nothing chosen yet'
    this.els.clearVideo.disabled = !filePath
  }

  setImagePath(filePath) {
    this.imagePath = filePath || null
    this.els.imagePath.textContent = filePath ? `Looping ${baseName(filePath)}` : 'Nothing chosen yet'
    this.els.clearImage.disabled = !filePath
  }

  // Spectrum picks its color from a fixed palette (showspectrum's own
  // `color` option is a named scheme, not an arbitrary hex - see
  // visualizationVideo.js), so the raw color picker only applies to
  // Waveform/Vectorscope.
  updateVizFieldVisibility() {
    const isSpectrum = this.els.vizType.value === 'spectrum'
    this.els.vizColorRow.hidden = isSpectrum
    this.els.vizPaletteRow.hidden = !isSpectrum
  }

  selectedPreset() {
    return this.presets.find((p) => p.id === this.els.preset?.value) ?? null
  }

  availableSoundCount(preset) {
    if (!preset) return 0
    return preset.sounds.filter((ps) => this.library.find((e) => e.id === ps.soundId)?.status === 'ok').length
  }

  // ---- the summary card: before, during and after an export ----

  renderSummary() {
    const sum = this.els.sum
    if (!sum) return
    const msg = this.message ? `<p class="ex-msg ${this.message.kind ?? ''}">${esc(this.message.text)}</p>` : ''
    if (this.view === 'run') {
      sum.innerHTML = `
        <div class="ex-big">${ring('<span class="ex-mid ex-num2" id="export-pct">0%</span>')}</div>
        <h2 class="ex-sumt">${esc(this.runTitle)}</h2>
        <p class="ex-hint" id="export-elapsed"></p>
        <ol class="ex-steps" id="export-steps"></ol>
        <div class="ex-actions">
          <button class="ex-b ex-ghost" type="button" data-act="copy-log">${icon('copy')}Copy log</button>
          <button class="ex-b ex-ghost" type="button" data-act="toggle-log" aria-expanded="${this.logOpen}">${this.logOpen ? 'Hide log' : 'Show log'}</button>
        </div>
        <pre class="ex-log" id="export-log" ${this.logOpen ? '' : 'hidden'}></pre>`
      this.renderProgress()
      this.renderSteps()
      this.renderLog()
      this.tickElapsed?.()
      return
    }
    if (this.view === 'done' || this.view === 'fail') {
      const r = this.result
      const ok = this.view === 'done'
      const dl = (r.rows ?? []).map(([t, d]) => `<dt>${t}</dt><dd title="${esc(d)}">${esc(d)}</dd>`).join('')
      const notes = (r.notes ?? []).map((n) => `<li class="${n.kind ?? ''}">${esc(n.text)}</li>`).join('')
      sum.innerHTML = `
        <div class="ex-big ${ok ? 'done' : 'fail'}" style="--p:100">${ring(`<span class="ex-mid">${icon(ok ? 'check' : 'x', 40)}</span>`)}</div>
        <h2 class="ex-sumt">${ok ? 'Export finished' : 'Export failed'}</h2>
        ${dl ? `<dl>${dl}</dl>` : ''}
        ${notes ? `<ul class="ex-notes">${notes}</ul>` : ''}
        <div class="ex-actions">
          <button class="ex-b ex-ghost" type="button" data-act="copy-log">${icon('copy')}Copy log</button>
          <button class="ex-b ex-ghost" type="button" data-act="toggle-log" aria-expanded="${this.logOpen}">${this.logOpen ? 'Hide log' : 'Show log'}</button>
        </div>
        <pre class="ex-log" id="export-log" ${this.logOpen ? '' : 'hidden'}></pre>
        <button class="ex-b ex-ghost ex-wide" type="button" data-act="again">Export another</button>`
      this.renderLog()
      return
    }
    const preset = this.selectedPreset()
    const count = this.availableSoundCount(preset)
    let dl
    if (this.kind === 'phone') {
      dl = `<dt>Sounds</dt><dd>${count}</dd><dt>File</dt><dd>Phone preset (.ncvpreset)</dd>`
    } else {
      const seconds = parseDuration(this.els.length.value)
      const length = seconds && seconds > 0 ? formatDuration(seconds) : '--:--:--'
      dl = `<dt>Sounds</dt><dd>${count}</dd><dt>Length</dt><dd>${length}</dd><dt>File</dt><dd>${esc(describeFile({ format: this.format, seconds, videoMode: this.videoMode }))}</dd>`
    }
    sum.innerHTML = `
      <h2 class="ex-sumt">This export</h2>
      <dl>${dl}</dl>
      ${this.lastFolder ? `<p class="ex-dest" title="${esc(this.lastFolder)}">${icon('folder')}<span>${esc(baseName(this.lastFolder))}</span></p>` : ''}
      ${msg}
      <button class="ex-b ex-pri ex-wide ex-tall" type="button" data-act="run" id="export-run" ${preset ? '' : 'disabled'}>${icon('upload')}Export</button>`
  }

  renderProgress() {
    const pct = Math.round((this.lastFraction ?? 0) * 100)
    const big = this.els.sum?.querySelector('.ex-big')
    if (big) big.style.setProperty('--p', String(pct))
    const label = this.els.sum?.querySelector('#export-pct')
    if (label) label.textContent = `${pct}%`
  }

  renderSteps() {
    const list = this.els.sum?.querySelector('#export-steps')
    if (!list) return
    const last = this.steps.length - 1
    list.innerHTML = this.steps
      .map((s, i) => {
        const now = i === last && s.took == null
        const meta = now ? (this.etaText ?? '') : s.took != null ? formatDuration(s.took) : ''
        return `<li class="${now ? 'now' : 'done'}">${icon(now ? 'circle' : 'check')}<span>${esc(s.label)}</span><small>${meta}</small></li>`
      })
      .join('')
  }

  renderLog() {
    const pre = this.els.sum?.querySelector('#export-log')
    if (!pre) return
    pre.textContent = this.logLines.join('\n')
    pre.scrollTop = pre.scrollHeight
  }

  async copyLogToClipboard(btn) {
    const text = this.logLines.join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      const original = btn.innerHTML
      btn.textContent = 'Copied!'
      setTimeout(() => {
        btn.innerHTML = original
      }, 1200)
    } catch (err) {
      console.error('Export: failed to copy log', err)
    }
  }

  // Elapsed under the title and time left on the running step (inbox: "show
  // elapsed time and, if cheap, an estimated time remaining ... not just
  // buried in the log"). ETA is a simple extrapolation from the same 0..1
  // progress fraction the ring tracks (elapsed * remaining/done) - unreliable
  // in the first moment or two of a run, so it's withheld until the fraction
  // is far enough along to mean anything.
  startElapsedTicker(renderStartedAt) {
    this.stopElapsedTicker()
    this.lastFraction = 0
    this.etaText = ''
    this.tickElapsed = () => {
      const elapsedSeconds = (Date.now() - renderStartedAt) / 1000
      this.etaText = ''
      if (this.lastFraction > 0.02 && this.lastFraction < 1) {
        const etaSeconds = (elapsedSeconds * (1 - this.lastFraction)) / this.lastFraction
        this.etaText = `${formatDuration(etaSeconds)} left`
      }
      const el = this.els.sum?.querySelector('#export-elapsed')
      if (el) el.textContent = `${formatDuration(elapsedSeconds)} elapsed`
      this.renderSteps()
    }
    this.tickElapsed()
    this.elapsedTimer = setInterval(this.tickElapsed, 1000)
  }

  stopElapsedTicker() {
    if (this.elapsedTimer) clearInterval(this.elapsedTimer)
    this.elapsedTimer = null
    this.tickElapsed = null
  }

  async refresh() {
    const [presets, library] = await Promise.all([this.api.presets.list(), this.api.library.list()])
    this.presets = presets
    this.library = library
    const previouslySelected = this.els.preset.value
    this.els.preset.innerHTML = presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    // Each visit to the tab starts on the preset loaded in the Mixer.
    this.els.preset.value = pickDefaultPresetId(presets, requestActivePresetId(), previouslySelected)
    this.renderSummary()
  }

  // No Export-tab UI of its own for these - instead inherits the exported
  // preset's own Preset Remix `wholeMix` directly, applied last over the
  // whole export. Direct owner answer (2026-09-02): "Yeah it should
  // [inherit them]. Should be the last thing applied tho."
  //
  // Forwards the whole normalized `wholeMix` object (spread), not a
  // hand-picked field list - BUG FIX (v0.1.171): the old list-of-four here
  // silently dropped Echo, Reverb, and Fluctuation. `wholeMix` is `null` on a
  // preset with no Preset Remix settings, which collapses to the same
  // all-neutral shape this always returned.
  currentWholeMixFilters(preset) {
    const wholeMix = preset?.wholeMix
    if (!wholeMix) return { highpassHz: 0, lowpassHz: 20000, gainDb: 0, eq: [] }
    return { ...wholeMix }
  }

  showMessage(text, kind = '') {
    this.message = { text, kind }
    this.renderSummary()
  }

  beginRun(title) {
    this.exporting = true
    this.message = null
    this.view = 'run'
    this.runTitle = title
    this.steps = []
    this.logLines = []
    this.lastFraction = 0
    const startedAt = Date.now()
    this.lastStepAt = startedAt
    this.renderSummary()
    this.startElapsedTicker(startedAt)
    return startedAt
  }

  endRun(ok, result) {
    this.closeLastLogLineTiming()
    this.stopElapsedTicker()
    this.exporting = false
    this.result = result
    this.view = ok ? 'done' : 'fail'
    this.api.settings.get().then((st) => { this.lastFolder = st.lastExportFolder ?? this.lastFolder }).catch(() => {})
    this.renderSummary()
    playCompletionChime(ok)
  }

  // "For phone" (app 0.1.268+): the app bakes each sound's clip, filters and
  // reverb included, into a .ncvpreset the Noctívago phone app plays live.
  async runPhoneExport(preset) {
    if (!this.api.export.runPhone) {
      this.showMessage('Update Noctívago to export for phone.', 'err')
      return
    }
    const outputPath = await this.api.export.pickDestination({ defaultName: preset.name, fileName: `${preset.name} - phone`, format: 'ncvpreset' })
    if (!outputPath) return

    const startedAt = this.beginRun(`Exporting ${preset.name} for phone`)
    let result
    try {
      result = await this.api.export.runPhone({ presetId: preset.id, outputPath })
    } catch (err) {
      result = { ok: false, error: err.message }
    }
    const took = formatDuration((Date.now() - startedAt) / 1000)
    if (result.ok) {
      this.endRun(true, {
        rows: [['File', baseName(result.path)], ['Sounds', String(result.soundCount)], ['Size', formatBytes(result.totalBytes)], ['Took', took]],
        notes: [{ text: `Saved to ${result.path}` }, { text: 'Send this file to your phone and open it with Noctívago.' }, ...(result.warnings ?? []).map((w) => ({ text: w, kind: 'warn' }))]
      })
    } else {
      this.endRun(false, { rows: [['Took', took]], notes: [{ text: result.error, kind: 'err' }] })
    }
  }

  async runExport() {
    if (this.exporting) return
    const preset = this.selectedPreset()
    if (!preset) {
      this.showMessage('Choose a preset first.', 'err')
      return
    }
    if (this.kind === 'phone') return this.runPhoneExport(preset)
    const durationSeconds = parseDuration(this.els.length.value)
    if (!durationSeconds || durationSeconds <= 0) {
      this.showMessage('Enter a valid length (hh:mm:ss).', 'err')
      return
    }

    // BUG FIX (reported directly, "fix ASAP"): a Sound Group's own EQ/
    // filters sound exactly right live but had zero effect on an export.
    // Each exported sound now carries which group (if any) it belongs to,
    // and the group's own filters, so exportMix.js can route that group's
    // members through their own filter chain before the final mix - the
    // same bus a live SoundGroupChain already applies.
    const groupIdBySoundId = new Map()
    const groupFluctuationById = new Map()
    for (const group of preset.groups ?? []) {
      groupFluctuationById.set(group.id, group.filters?.fluctuation ?? null)
      for (const soundId of group.soundIds) groupIdBySoundId.set(soundId, group.id)
    }

    const sounds = []
    // Parallel to `sounds` (same filter, same order) but scoped to just what
    // the optional info.txt describes.
    const soundInfoList = []
    // What "How the scene is set up" describes: each sound's effective
    // settings in this preset, with its volume.
    const sceneSounds = []
    for (const presetSound of preset.sounds) {
      const baseline = this.library.find((e) => e.id === presetSound.soundId)
      if (!baseline || baseline.status !== 'ok') continue
      // Per-preset sound overrides (planned 2026-09-12): export must reflect
      // this preset's own effective view of the sound, not its raw baseline.
      const entry = applySoundOverride(baseline, presetSound.overrides)
      const playMode = entry.playMode ?? 'loop'
      sounds.push({
        soundId: entry.id,
        name: entry.name,
        playMode,
        loopStart: entry.loopStart ?? 0,
        loopEnd: entry.loopEnd ?? entry.durationSeconds ?? 0,
        filters: entry.filters ?? {},
        speedPitch: entry.speedPitch ?? null,
        crossfadeSeconds: entry.crossfadeSeconds ?? null,
        volume: presetSound.volume ?? entry.volume ?? 0.7,
        groupId: groupIdBySoundId.get(entry.id) ?? null,
        // Volume Fluctuation (v0.1.171) - baked for loop-mode sounds only.
        fluctuation: entry.fluctuation ?? null,
        // v0.1.218: a group drift axis set to "each sound on its own" sets
        // this sound's per-play random range for that axis.
        events: simulateEvents({
          entry: (() => {
            const groupFluctuation = groupFluctuationById.get(groupIdBySoundId.get(entry.id)) ?? null
            if (!groupFluctuation) return entry
            return {
              ...entry,
              scatter: applyGroupShotOverride(entry.scatter, groupFluctuation),
              schedule: applyGroupShotOverride(entry.schedule, groupFluctuation)
            }
          })(),
          durationSeconds
        })
      })
      soundInfoList.push({ name: entry.name, tags: entry.tags ?? [] })
      sceneSounds.push({ entry, volume: presetSound.volume ?? entry.volume ?? 0.7 })
    }

    if (sounds.length === 0) {
      this.showMessage('Nothing to export - this preset has no available sounds.', 'err')
      return
    }

    // Picking "Loop a video file"/"Loop an image" without ever choosing one
    // used to run anyway and silently fall back to a black screen. Caught
    // here, before the destination picker even opens.
    const needsVideo = this.videoMode !== 'audio-only'
    if (needsVideo && this.videoBackground === 'file' && !this.loopVideoPath) {
      this.showMessage('Choose a video file to loop, or pick another video option.', 'err')
      return
    }
    if (needsVideo && this.videoBackground === 'image' && !this.imagePath) {
      this.showMessage('Choose an image to loop, or pick another video option.', 'err')
      return
    }

    const format = this.format
    // Filename: "{preset name} - {video kind} - {length}" (inbox request);
    // the folder itself (defaultName) stays just the preset name so
    // re-exporting the same preset keeps landing in the same folder.
    const fileName = [preset.name, needsVideo ? videoKindFileLabel(this.videoBackground, this.els.vizType.value) : null, formatDurationCompact(durationSeconds)]
      .filter(Boolean)
      .join(' - ')
    const outputPath = await this.api.export.pickDestination({ defaultName: preset.name, fileName, format })
    if (!outputPath) return

    // How long the render itself took, wall-clock - reported directly ("let
    // the user know how much time it took to fully render").
    const renderStartedAt = this.beginRun(`Exporting ${preset.name}`)
    const fadeInSeconds = Number(this.els.fadeIn.value) || 0
    const fadeOutSeconds = Number(this.els.fadeOut.value) || 0
    let outcome

    try {
      const result = await this.api.export.run({
        sounds,
        durationSeconds,
        format,
        wholeMixFilters: this.currentWholeMixFilters(preset),
        groups: (preset.groups ?? []).map((g) => ({ id: g.id, filters: g.filters })),
        fadeInSeconds,
        fadeOutSeconds,
        outputPath
      })
      this.closeLastLogLineTiming()
      const took = formatDuration((Date.now() - renderStartedAt) / 1000)
      if (result.ok) {
        // 'video-only' deletes the standalone audio file once the video
        // exists (see exportMix.js), so lead with the video in that case.
        const mainPath = result.audioRemoved ? result.videoPath : outputPath
        const notes = [{ text: `Saved to ${mainPath}` }]
        if (result.videoPath && !result.audioRemoved) notes.push({ text: `Video: ${result.videoPath}` })
        // A failed video in 'video-only' mode leaves the audio file in place.
        else if (result.videoError) notes.push({ text: `Video render failed: ${result.videoError}`, kind: 'err' })
        if (this.isOn(this.els.infoFile)) {
          // Looks up missing Freesound license details. A failed lookup
          // still writes the file, with whatever is already known.
          let credits = sceneSounds.map(({ entry }) => ({ name: entry.name, source: entry.source ?? null }))
          try {
            const resolved = await this.api.library.resolveCredits(sceneSounds.map(({ entry }) => entry.id))
            const byId = new Map(resolved.map((c) => [c.id, c]))
            credits = sceneSounds.map(({ entry }) => ({ name: entry.name, source: byId.get(entry.id)?.source ?? entry.source ?? null }))
          } catch (err) {
            console.error('Export: credit lookup failed', err)
          }
          const infoContent = buildInfoFileText({
            presetName: preset.name,
            durationSeconds,
            format,
            videoMode: this.videoMode,
            videoBackground: this.videoBackground,
            loopVideoName: this.loopVideoPath ? baseName(this.loopVideoPath) : null,
            imageName: this.imagePath ? baseName(this.imagePath) : null,
            imageMotion: this.els.imageMotion.value,
            visualizationSummary: `${this.els.vizType.value} visualization (${this.els.vizSize.value}, ${this.els.vizFps.value}fps)`,
            soundInfoList,
            fadeInSeconds,
            fadeOutSeconds,
            sceneLines: buildSceneSection({ sounds: sceneSounds, groups: preset.groups ?? [], wholeMix: preset.wholeMix ?? null }),
            creditLines: buildCreditsSection(credits),
            prompt: this.els.infoPrompt.value
          })
          const infoResult = await this.api.export.writeInfoFile({ outputPath, content: infoContent })
          notes.push(infoResult.ok ? { text: `Info file: ${infoResult.infoPath}` } : { text: `Info file failed: ${infoResult.error}`, kind: 'err' })
        }
        const size = result.audioRemoved ? null : estimateBytes(format, durationSeconds)
        const rows = [['File', baseName(mainPath)], ...(size ? [['Size', `About ${formatBytes(size)}`]] : []), ['Took', took]]
        outcome = { ok: true, result: { rows, notes } }
      } else {
        outcome = { ok: false, result: { rows: [['Took', took]], notes: [{ text: result.error, kind: 'err' }] } }
      }
    } catch (err) {
      console.error('Export failed', err)
      this.closeLastLogLineTiming()
      const took = formatDuration((Date.now() - renderStartedAt) / 1000)
      outcome = { ok: false, result: { rows: [['Took', took]], notes: [{ text: err.message, kind: 'err' }] } }
    } finally {
      // Reported directly after a real overnight export ("i dozed off and
      // didn't get the log") - the log is written next to the export on both
      // success and failure. Silent/best-effort bookkeeping.
      if (this.logLines.length > 0) {
        try {
          await this.api.export.writeLogFile({ outputPath, content: this.logLines.join('\n') })
        } catch (err) {
          console.error('Export: failed to write log file', err)
        }
      }
      this.endRun(outcome?.ok ?? false, outcome?.result ?? { notes: [{ text: 'Export stopped.', kind: 'err' }] })
    }
  }
}
