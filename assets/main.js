// Playback, tab switching and the RPM/torque traces under each clip.
// Everything it needs is committed alongside it; there are no network calls
// beyond fetching that one JSON file from the same origin -- and even that
// is only a fallback, since the same data is also embedded in the page.

const CURVES_URL = "assets/curves/clips.json";
const METRICS_URL = "assets/metrics.json";

// A file:// origin blocks fetch() outright, which would otherwise leave
// every canvas blank with no traces for anyone who just double-clicks
// index.html. tools/embed_curves.py mirrors assets/curves/clips.json into a
// <script type="application/json" id="curve-data"> element in the page
// itself, so reading that element first works with no server at all. The
// fetch below only runs when that element is missing.
function loadEmbeddedCurves() {
  const el = document.getElementById("curve-data");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent).clips;
  } catch (error) {
    console.warn("embedded curve data is not valid JSON:", error);
    return null;
  }
}

async function loadCurves() {
  const embedded = loadEmbeddedCurves();
  if (embedded) return embedded;
  const response = await fetch(CURVES_URL);
  if (!response.ok) throw new Error(`curves unavailable: ${response.status}`);
  return (await response.json()).clips;
}

// The hero tile ships with hard-coded counts as a no-JS fallback; a weekly
// workflow refreshes assets/metrics.json but nothing else reads it, so those
// counts silently go stale. Hydrate from the JSON on success only, leaving
// the fallback in place if the fetch fails. The JSON's mirror key
// ("Hugging Face (copy)") is mapped to the page's own wording ("mirror")
// rather than printed as-is.
async function hydrateDownloadsTile() {
  const tile = document.querySelector("#downloads-tile");
  if (!tile) return;
  const response = await fetch(METRICS_URL);
  if (!response.ok) throw new Error(`metrics unavailable: ${response.status}`);
  const metrics = await response.json();

  const setText = (metric, value) => {
    const el = tile.querySelector(`[data-metric="${metric}"]`);
    if (el) el.textContent = value;
  };
  const format = (n) => n.toLocaleString("en-US");

  setText("total", format(metrics.totals.downloads_all_time));
  setText("hf-original", format(metrics.sources["Hugging Face (original)"].metrics.downloads_all_time));
  setText("hf-mirror", format(metrics.sources["Hugging Face (copy)"].metrics.downloads_all_time));
  setText("zenodo", format(metrics.sources.Zenodo.metrics.downloads_all_time));
  setText("as-of", metrics.retrieved_at.slice(0, 10));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// clips.json's duration_sec is known good; an <audio> element's own
// .duration can read as Infinity (Opus streams before metadata settles) or
// NaN before metadata loads at all, either of which must be treated as
// "unknown", not as zero -- and definitely not as a seek target.
function clipDuration(clip) {
  return Number.isFinite(clip.duration_sec) && clip.duration_sec > 0 ? clip.duration_sec : null;
}

function resolveDuration(clip, audio) {
  return clipDuration(clip)
    ?? (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
}

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Draw both traces on their own vertical scale: RPM and torque share no units,
// and forcing them onto one axis would flatten whichever has the smaller range.
// Each trace also gets a label — its quantity, unit and the range of the
// clip's own curve data, read straight from the arrays at draw time — plus a
// shared baseline hairline, so the pair reads as a labelled plot rather than
// two bare lines floating in the box.
//
// Each series also gets a small swatch ahead of its label, in the transport
// row (see createTransport), read from the same --rpm/--torque variables the
// trace itself uses so it tracks the theme. RPM/torque were repicked as
// blue/orange specifically so the two series sit ~26 dE apart under
// tritanopia (was ~7.1 dE on the old deep/green pair, a borderline gap) --
// colour alone now separates them. The swatches stay anyway: they cost
// nothing and are a second, redundant cue. The label text itself stays in the
// muted ink colour deliberately: only the swatch and the axis carry the
// colour identity, so this never becomes coloured body text.

// Left/right gutters reserved for the y-axis tick labels (RPM on the left,
// torque on the right, each colour-matched to its series). Shared between
// drawCurve and the click-to-seek handler below so a click always lands on
// the same time position the trace is actually drawn at.
const AXIS_LEFT = 34;
const AXIS_RIGHT = 36;
const AXIS_TICKS = 4; // 5 grid rows, i = 0..4

// Breathing room above the topmost grid row, so the highest y-axis tick label
// is not clipped by the canvas edge.
const PLOT_TOP_PAD = 10;

function formatRange(lo, hi, name, unit) {
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const suffix = unit ? ` ${unit}` : "";
  return `${name} ${fmt(lo)}–${fmt(hi)}${suffix}`;
}

// RPM ticks read compactly ("6.9k") once they clear four digits; torque
// ticks stay whole N·m, matching the units already spelled out in the range
// label above the plot.
function formatRpmTick(value) {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
function formatTorqueTick(value) {
  return String(Math.round(value));
}

// The canvas is the whole transport's scrubber, so it carries the waveform
// too: a soft filled shape, mirrored around the plot's own centre line, sits
// behind the RPM/torque traces. It is drawn first so the traces and playhead
// always read on top of it. Confined to [plotLeft, plotLeft+plotWidth], the
// same horizontal span the traces and the axis gutters use, so the waveform
// never bleeds under the tick labels.
function drawWaveform(ctx, wave, plotLeft, plotWidth, plotTop, plotBottom, muted) {
  if (!wave || wave.length < 2) return;
  const center = (plotTop + plotBottom) / 2;
  const halfHeight = (plotBottom - plotTop) / 2;

  ctx.beginPath();
  wave.forEach((v, j) => {
    const x = plotLeft + (j / (wave.length - 1)) * plotWidth;
    const y = center - v * halfHeight;
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  for (let j = wave.length - 1; j >= 0; j--) {
    const x = plotLeft + (j / (wave.length - 1)) * plotWidth;
    const y = center + wave[j] * halfHeight;
    ctx.lineTo(x, y);
  }
  ctx.closePath();

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = muted;
  ctx.fill();
  ctx.restore();
}

// Faint horizontal grid rows behind the traces, at reduced alpha so they
// never compete with the data. Drawn across the plot span only (not under
// the axis gutters).
function drawGrid(ctx, plotLeft, plotWidth, plotTop, plotBottom, rule) {
  ctx.save();
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i <= AXIS_TICKS; i++) {
    const y = plotTop + ((plotBottom - plotTop) * i) / AXIS_TICKS;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
  }
  ctx.restore();
}

// A dashed reference line at torque = 0, drawn only when the clip's torque
// range actually crosses zero -- on the overrun clips especially, where
// torque goes negative is the whole story the plot needs to tell.
function drawTorqueZeroLine(ctx, plotLeft, plotWidth, y, rule) {
  ctx.save();
  ctx.strokeStyle = rule;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(plotLeft, y);
  ctx.lineTo(plotLeft + plotWidth, y);
  ctx.stroke();
  ctx.restore();
}

// Colour-matched y-axis tick labels: RPM down the left edge in the RPM
// colour, torque down the right edge in the torque colour. Two scales on one
// plot only reads cleanly if each axis is unmistakably tied to its series,
// so neither axis is ever drawn in neutral ink here.
function drawAxisTicks(ctx, plotLeft, plotWidth, plotTop, plotBottom, lo, hi, format, color, side, font) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = side === "left" ? "right" : "left";
  ctx.textBaseline = "middle";
  const x = side === "left" ? plotLeft - 6 : plotLeft + plotWidth + 6;
  for (let i = 0; i <= AXIS_TICKS; i++) {
    const y = plotTop + ((plotBottom - plotTop) * i) / AXIS_TICKS;
    const value = hi - ((hi - lo) * i) / AXIS_TICKS;
    ctx.fillText(format(value), x, y);
  }
  ctx.restore();
}

function drawCurve(canvas, clip, progress = 0) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const muted = cssVar("--muted");
  const rule = cssVar("--rule");
  const monoFont = cssVar("--font-mono") || "monospace";

  const series = [
    { values: clip.rpm, color: cssVar("--rpm"), name: "RPM", unit: "", format: formatRpmTick, side: "left" },
    { values: clip.torque, color: cssVar("--torque"), name: "torque", unit: "N·m", format: formatTorqueTick, side: "right" },
  ];
  // Each series' own [lo, hi] is computed up front: the grid, the zero line
  // and the axis ticks all need it before any drawing happens, not just the
  // trace loop that used to be the only consumer.
  series.forEach((s) => {
    s.lo = Math.min(...s.values);
    s.hi = Math.max(...s.values);
    s.span = s.hi - s.lo || 1;
  });
  const torqueSeries = series[1];

  // The range legend now lives in the transport row above, so the canvas is
  // the plot and nothing else -- no label strip to collide with.
  const plotLeft = AXIS_LEFT;
  const plotWidth = Math.max(width - AXIS_LEFT - AXIS_RIGHT, 1);
  const plotTop = PLOT_TOP_PAD;
  const plotBottom = height - 6;
  const plotHeight = Math.max(plotBottom - plotTop, 1);

  drawGrid(ctx, plotLeft, plotWidth, plotTop, plotBottom, rule);

  if (torqueSeries.lo < 0 && torqueSeries.hi > 0) {
    const zeroY = plotBottom - ((0 - torqueSeries.lo) / torqueSeries.span) * plotHeight;
    drawTorqueZeroLine(ctx, plotLeft, plotWidth, zeroY, rule);
  }

  drawWaveform(ctx, clip.wave, plotLeft, plotWidth, plotTop, plotBottom, muted);

  ctx.textBaseline = "top";

  series.forEach(({ values, color, lo, span }) => {
    ctx.beginPath();
    values.forEach((value, j) => {
      const x = plotLeft + (j / (values.length - 1)) * plotWidth;
      const y = plotBottom - ((value - lo) / span) * plotHeight;
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Labelled y-axes on both sides, each colour-matched to its own series --
  // required, not optional, since a neutral-ink axis on a two-scale plot
  // leaves a reader unable to tell which numbers belong to which trace.
  const axisFont = `11px ${monoFont}`;
  series.forEach(({ lo, hi, format, color, side }) => {
    drawAxisTicks(ctx, plotLeft, plotWidth, plotTop, plotBottom, lo, hi, format, color, side, axisFont);
  });

  // A single reference hairline under the traces, so they sit in a plot
  // rather than floating unanchored in the box. Confined to the plot span:
  // run edge to edge it crossed straight through the y-axis tick labels
  // sitting in the gutters on either side.
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom + 0.5);
  ctx.lineTo(plotLeft + plotWidth, plotBottom + 0.5);
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (progress > 0) {
    // Confined to the plot band. Drawn over the full canvas height it ran
    // straight through the range labels above the plot, which read as the
    // axis colliding with the text.
    const x = plotLeft + progress * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Canvases in hidden tab panels measure clientWidth 0, so a canvas drawn while
// hidden must be redrawn once its panel is revealed. This registry lets the
// tab switcher (initTabs) find and re-run each canvas's own redraw, without
// initTabs needing to know anything about clips or audio elements.
const canvasRedraws = new Map();

// One binding per <canvas>: owns the resize/click listeners (added exactly
// once, no matter how many audio elements share this canvas) and tracks which
// audio element's position the trace currently reflects. The canvas is the
// whole transport's scrubber, so its click handler is also the seek control.
//
// `clip` is a plain local variable, not a fixed parameter: the comparison
// section's one shared canvas needs to redraw from a *different* clip's own
// wave/rpm/torque data whenever the visitor switches engine (setClip below),
// while every other canvas on the page just never calls it and keeps the
// clip it was built with.
function bindCanvas(canvas, initialClip) {
  let clip = initialClip;
  let activeAudio = null;
  const redraw = () => {
    let progress = 0;
    if (activeAudio) {
      const duration = resolveDuration(clip, activeAudio);
      if (duration) progress = activeAudio.currentTime / duration;
    }
    drawCurve(canvas, clip, progress);
  };
  window.addEventListener("resize", redraw);

  canvas.addEventListener("click", (event) => {
    if (!activeAudio) return;
    const duration = resolveDuration(clip, activeAudio);
    if (!duration) return;
    // Mirrors the plotLeft/plotWidth math in drawCurve exactly, so a click
    // lands on the same time position the trace is actually drawn at -- the
    // axis gutters added for the y-axis tick labels are not part of the
    // seekable span.
    const rect = canvas.getBoundingClientRect();
    const plotWidth = Math.max(rect.width - AXIS_LEFT - AXIS_RIGHT, 1);
    const ratio = Math.min(Math.max((event.clientX - rect.left - AXIS_LEFT) / plotWidth, 0), 1);
    activeAudio.currentTime = ratio * duration;
  });

  drawCurve(canvas, clip, 0);
  canvasRedraws.set(canvas, redraw);

  return {
    focus(audio) { activeAudio = audio; redraw(); },
    reset(audio) { activeAudio = audio; drawCurve(canvas, clip, 0); },
    setClip(newClip) { clip = newClip; redraw(); },
  };
}

// One binding per <audio>: owns only the audio-level listeners, so a canvas
// shared by several players (the comparison section) gets these once per
// player instead of once per canvas.
function bindAudioToCanvas(audio, canvasBinding) {
  audio.addEventListener("timeupdate", () => canvasBinding.focus(audio));
  audio.addEventListener("seeked", () => canvasBinding.focus(audio));
  audio.addEventListener("play", () => canvasBinding.focus(audio));
  audio.addEventListener("ended", () => canvasBinding.reset(audio));
}

// The custom transport: a play/pause button plus a mono time readout. It
// replaces the native <audio controls> bar; the canvas next to it is the
// scrubber. Built once per <audio> element and inserted right after it, so
// no-JS visitors (who never see this) keep the native bar in its place.
const PLAY_ICON_SVG = `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path class="icon-play" d="M4 2.5 L13 8 L4 13.5 Z"></path>
    <g class="icon-pause">
      <rect x="4" y="2.5" width="3" height="11"></rect>
      <rect x="9" y="2.5" width="3" height="11"></rect>
    </g>
  </svg>`;

// Seconds moved per arrow-key press on the play button, giving the transport
// keyboard operability without a mouse-driven click on the (aria-hidden)
// canvas.
const KEY_SEEK_STEP = 5;

function createTransport(clip) {
  const wrap = document.createElement("div");
  wrap.className = "transport";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "play-btn";
  button.dataset.state = "paused";
  button.setAttribute("aria-label", "Play");
  button.innerHTML = PLAY_ICON_SVG;

  const time = document.createElement("span");
  time.className = "time-readout";
  time.textContent = `0:00 / ${formatTime(clipDuration(clip))}`;

  // The range legend lives in the transport row rather than inside the
  // canvas. Drawn in the canvas it had to share the top strip with the plot,
  // where the grid rules and the y-axis tick labels kept colliding with it,
  // and no amount of padding fixed that -- the two simply wanted the same
  // pixels. Out here it is also selectable text rather than bitmap.
  const legend = document.createElement("span");
  legend.className = "clip-legend";
  [
    { name: "RPM", unit: "", values: clip.rpm, var: "--rpm" },
    { name: "torque", unit: "N·m", values: clip.torque, var: "--torque" },
  ].forEach(({ name, unit, values, var: cssVarName }) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = `var(${cssVarName})`;
    const text = document.createElement("span");
    text.textContent = formatRange(Math.min(...values), Math.max(...values), name, unit);
    item.append(swatch, text);
    legend.append(item);
  });

  wrap.append(button, time, legend);
  return { wrap, button, time };
}

function wireTransport(transport, audio, clip) {
  const { button, time } = transport;

  const setPlayingState = (isPlaying) => {
    button.dataset.state = isPlaying ? "playing" : "paused";
    button.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  };
  const updateTime = () => {
    const duration = resolveDuration(clip, audio);
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
  };

  button.addEventListener("click", () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const duration = resolveDuration(clip, audio);
    const step = event.key === "ArrowRight" ? KEY_SEEK_STEP : -KEY_SEEK_STEP;
    const upperBound = duration ?? Infinity;
    audio.currentTime = Math.min(Math.max(audio.currentTime + step, 0), upperBound);
    event.preventDefault();
  });

  audio.addEventListener("play", () => setPlayingState(true));
  audio.addEventListener("pause", () => setPlayingState(false));
  audio.addEventListener("ended", () => setPlayingState(false));
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("seeked", updateTime);
  audio.addEventListener("loadedmetadata", updateTime);

  updateTime();
}

// Hands one <audio> element off to the custom transport: the native bar is
// dropped (controls removed, element hidden by the audio:not([controls])
// rule in style.css) and a play button + time readout take its place in the
// same spot in the DOM. No-JS visitors never run this, so they keep the
// native bar as a working fallback.
function setupCustomTransport(audio, clip) {
  const transport = createTransport(clip);
  wireTransport(transport, audio, clip);
  audio.removeAttribute("controls");
  audio.insertAdjacentElement("afterend", transport.wrap);
  return transport;
}

// Only one clip plays at a time; starting a second stops the first.
function soloPlayback() {
  const players = Array.from(document.querySelectorAll("audio"));
  players.forEach((audio) => {
    audio.addEventListener("play", () => {
      players.filter((other) => other !== audio && !other.paused)
             .forEach((other) => other.pause());
    });
  });
}

// Any clip left playing when its panel is hidden would otherwise keep
// playing with no visible controls (display: none hides the <audio> but
// does not pause it).
function pausePanelAudio(panel) {
  panel.querySelectorAll("audio").forEach((audio) => {
    if (!audio.paused) audio.pause();
  });
}

// A canvas drawn while its panel was hidden sized itself to 0x0; redraw every
// canvas in a panel as soon as it becomes visible so its traces are correct
// without waiting for playback.
function redrawPanelCanvases(panel) {
  panel.querySelectorAll(".curve-canvas").forEach((canvas) => {
    const redraw = canvasRedraws.get(canvas);
    if (redraw) redraw();
  });
}

function initTabs() {
  const tabs = document.querySelectorAll(".set-selector-group button[data-set]");
  const panels = document.querySelectorAll(".set-panel[data-set]");
  const show = (set) => {
    tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.set === set)));
    let shown = null;
    panels.forEach((panel) => {
      const isTarget = panel.dataset.set === set;
      if (!isTarget) pausePanelAudio(panel);
      panel.hidden = !isTarget;
      if (isTarget) shown = panel;
    });
    if (shown) redrawPanelCanvases(shown);
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.set)));
  if (tabs.length) show(tabs[0].dataset.set);
}

function initExamples(curves) {
  document.querySelectorAll(".clip[data-clip-id]").forEach((block) => {
    const clip = curves[block.dataset.clipId];
    const canvas = block.querySelector(".curve-canvas");
    const audio = block.querySelector("audio");
    if (clip && canvas && audio) {
      const canvasBinding = bindCanvas(canvas, clip);
      bindAudioToCanvas(audio, canvasBinding);
      setupCustomTransport(audio, clip);
      // Same reasoning as the comparison section: make the scrubber usable
      // by click before the clip has ever been played.
      canvasBinding.focus(audio);
    }
  });
}

// The nav's links are plain working anchors in the markup with no JS
// involvement at all -- this only layers a "you are here" highlight on top
// using IntersectionObserver, so a no-JS visitor loses nothing but that
// highlight. Guarded on the API's existence for the same reason.
function initSectionNav() {
  const nav = document.querySelector("#section-nav");
  if (!nav || !("IntersectionObserver" in window)) return;

  const links = Array.from(nav.querySelectorAll("a[href^='#']"));
  const linkById = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const sections = Array.from(document.querySelectorAll("main > section[id]"))
    .filter((section) => linkById.has(section.id));
  if (!sections.length) return;

  const setCurrent = (id) => {
    links.forEach((a) => a.removeAttribute("aria-current"));
    linkById.get(id)?.setAttribute("aria-current", "true");
  };

  // A band around the vertical middle of the viewport, offset below the
  // sticky bar itself: whichever section's heading is inside that band
  // counts as "current", rather than whichever merely touches the viewport
  // edge (which would flicker between neighbours while scrolling).
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setCurrent(visible[0].target.id);
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
  );
  sections.forEach((section) => observer.observe(section));
}

async function main() {
  initTabs();
  initSectionNav();
  soloPlayback();
  try {
    const curves = await loadCurves();
    initExamples(curves);
  } catch (error) {
    // The players still work without the traces; leaving the canvases blank is
    // a better outcome than an error banner over a page that mostly functions.
    console.warn("control traces unavailable:", error);
  }
  try {
    await hydrateDownloadsTile();
  } catch (error) {
    // Hard-coded counts stay on screen as the fallback.
    console.warn("download metrics unavailable:", error);
  }
}

document.addEventListener("DOMContentLoaded", main);
