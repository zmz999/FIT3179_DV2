// Loads the charts on the page.
//
// Each chart is an empty <div> in index.html. This file fetches the matching
// Vega-Lite spec from specs/, fits it to the width of its card and embeds it
// with vegaEmbed.

// The id of each chart's <div> and its spec file, in page order.
const CHARTS = [
  ['v14',  'specs/14_oscar_timeline.vl.json'],
  ['v01',  'specs/01_stacked_area.vl.json'],
  ['v02',  'specs/02_world_shares.vl.json'],
  ['v02c', 'specs/02c_concentration.vl.json'],
  ['v09',  'specs/09_coproduction_map.vl.json'],
  ['v15',  'specs/15_filming_dots.vl.json'],
  ['v03',  'specs/03_connected_scatter.vl.json'],
  ['v04',  'specs/04_ridgeline.vl.json'],
  ['v05',  'specs/05_genre_heatmap.vl.json'],
  ['v06',  'specs/06_hexbin.vl.json'],
  ['v07',  'specs/07_rating_box.vl.json'],
  ['v08',  'specs/08_awards_mosaic.vl.json'],
  ['v10',  'specs/10_malaysia_bump.vl.json'],
  ['v11',  'specs/11_malaysia_audience.vl.json'],
  ['v13',  'specs/13_malaysia_cinema_map.vl.json'],
];

// Options passed to vegaEmbed. The page styles the tooltips itself (css/style.css),
// so vega-embed's built-in tooltip stylesheet is turned off.
const OPTS = {
  actions: false,
  renderer: 'canvas',
  tooltip: { theme: 'light', disableDefaultStyle: true }
};

// The chart text uses the page's web fonts. A canvas draws its text once, so a
// chart drawn before the fonts arrive would keep the fallback font. Every chart
// waits for them, or for three seconds if they are slow to load.
const FONTS = ['400 12px Inter', '500 12px Inter', '600 12px Inter',
               '400 12px "DM Serif Display"'];
const fontsReady = Promise.race([
  Promise.all(FONTS.map(font => document.fonts.load(font))),
  new Promise(resolve => setTimeout(resolve, 3000))
]).catch(() => {});

// Chart sizing.
// The width in a spec is the width of the plot only; axes, legends and titles
// add to it. Each chart is drawn, measured, and drawn again with a plot width
// that makes the whole chart fit its card. MIN_PLOT is the narrowest plot width
// used. A chart that is still too wide scrolls inside its card; its plot is then
// widened to the width the rest of the chart already takes up, so it does not
// scroll further.
const MIN_PLOT = 90;
const FIT_PASSES = 4;
const FIT_TOLERANCE = 2;

function getPlotWidth(spec) {
  if (typeof spec.width === 'number') return spec.width;
  if (spec.spec && typeof spec.spec.width === 'number') return spec.spec.width;
  return null;
}

// A spec can fix the ratio of its plot height to its plot width with
// "usermeta": {"aspect": ...}; the height then follows every width change.
// "usermeta": {"maxWidth": ...} caps the plot width, so a chart whose height
// follows its width does not grow too tall in a wide card.
// "usermeta": {"minWidth": ...} is the narrowest plot width at which a chart's marks
// and labels stay legible; on a narrower card the chart keeps that width and
// scrolls inside its card instead of crowding.
function setPlotWidth(spec, w) {
  if (typeof spec.width === 'number') spec.width = w;
  else if (spec.spec && typeof spec.spec.width === 'number') spec.spec.width = w;
  const aspect = spec.usermeta && spec.usermeta.aspect;
  if (aspect && typeof spec.height === 'number') spec.height = Math.round(w * aspect);
}

function renderedWidth(el) {
  const node = el.querySelector('svg, canvas');
  return node ? Math.ceil(node.getBoundingClientRect().width) : 0;
}

// Titles on narrow screens.
// Vega-Lite does not wrap a title: each title and subtitle is written as a list of
// lines, and a line wider than the card would push the chart wider than the card.
// On a narrow screen such a title is wrapped again here to the card's width, measured
// in the title's own font. Each sentence starts on a new line, and the lines of a
// sentence are made as even as possible. A title that fits is left as written.
const measureCtx = document.createElement('canvas').getContext('2d');

function textWidth(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Fill lines word by word, up to `width` pixels each.
function wrapWords(text, width, font) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const longer = line ? line + ' ' + word : word;
    if (line && textWidth(longer, font) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Wrap into as few lines as fit `width`, then make those lines as even as possible,
// so a wrapped sentence does not end with one word on a line of its own.
function wrapBalanced(text, width, font) {
  const lines = wrapWords(text, width, font);
  if (lines.length < 2) return lines;
  let lo = 1, hi = Math.floor(width);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrapWords(text, mid, font).length <= lines.length) hi = mid;
    else lo = mid + 1;
  }
  return wrapWords(text, hi, font);
}

// The lines of a title or subtitle wrapped to `width`, or null if they already fit.
// Each sentence starts on a new line.
function rewrap(text, width, font) {
  if (text == null) return null;
  const lines = [].concat(text);
  if (lines.every(l => textWidth(l, font) <= width)) return null;
  const sentences = lines.join(' ').replace(/([.!?])\s+(?=[A-Z0-9])/g, '$1\n').split('\n');
  return sentences.flatMap(s => wrapBalanced(s.trim(), width, font));
}

// Wrap a spec's title and subtitle to a chart `avail` pixels wide. The title starts at
// the left edge of the chart, so it has the chart's width less its padding.
function fitTitle(spec, avail) {
  const title = spec.title;
  if (!title || typeof title !== 'object' || Array.isArray(title)) return;
  const cfg = (spec.config && spec.config.title) || {};
  const pad = typeof spec.padding === 'number'
    ? { left: spec.padding, right: spec.padding } : (spec.padding || {});
  const dx = typeof title.dx === 'number' ? title.dx : 0;
  const width = avail - (pad.left || 0) - (pad.right || 0) - dx - 1;
  const font = (weight, size, family) => `${weight} ${size}px ${family}`;
  const text = rewrap(title.text, width,
    font(cfg.fontWeight || 'bold', cfg.fontSize || 13, cfg.font || 'sans-serif'));
  if (text) title.text = text;
  if (title.subtitle) {
    const subtitle = rewrap(title.subtitle, width,
      font(cfg.subtitleFontWeight || 'normal', cfg.subtitleFontSize || 10,
           cfg.subtitleFont || 'sans-serif'));
    if (subtitle) title.subtitle = subtitle;
  }
}

const views = new Map();

// The current values of a chart's on-page controls (its sliders and radio
// buttons), so that a redraw can keep what the reader chose.
function controlValues(spec, view) {
  const values = {};
  for (const p of spec.params || []) {
    if (p.bind && p.bind.input) values[p.name] = view.signal(p.name);
  }
  return values;
}

// Fetch a spec, embed it in its <div> and fit it to the card. `keep` holds
// control values to restore after a redraw.
async function render(id, url, keep) {
  const el = document.getElementById(id);
  if (!el) return;
  await fontsReady;
  try {
    const spec = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });

    fitTitle(spec, el.clientWidth);
    let plot = getPlotWidth(spec);
    const designed = plot;
    const maxPlot = (spec.usermeta && spec.usermeta.maxWidth) || Infinity;
    const minPlot = (spec.usermeta && spec.usermeta.minWidth) || MIN_PLOT;
    let res = await vegaEmbed(el, spec, OPTS);
    // width of the axes, legends and labels at the designed plot width
    const overhead0 = plot ? renderedWidth(el) - plot : 0;
    let best = null;

    for (let pass = 0; plot && pass < FIT_PASSES; pass++) {
      const avail = el.clientWidth;
      const actual = renderedWidth(el);
      if (!avail) break;
      if (actual <= avail && (best === null || plot > best)) best = plot;
      if (actual <= avail && avail - actual <= FIT_TOLERANCE) break;
      const overhead = actual - plot;
      const corrected = Math.min(maxPlot, Math.max(minPlot, Math.floor(avail - overhead)));
      if (corrected === plot) break;
      plot = corrected;
      setPlotWidth(spec, plot);
      res.view.finalize();
      res = await vegaEmbed(el, spec, OPTS);
    }
    // Go back to the widest width that fitted if the last one is too wide.
    if (best !== null && best !== plot && renderedWidth(el) > el.clientWidth) {
      setPlotWidth(spec, best);
      res.view.finalize();
      res = await vegaEmbed(el, spec, OPTS);
    }
    // A chart that cannot fit: use the width its titles already take up.
    if (plot && best === null && renderedWidth(el) > el.clientWidth) {
      const fill = Math.min(designed, Math.floor(renderedWidth(el) - overhead0));
      if (fill > plot) {
        setPlotWidth(spec, fill);
        res.view.finalize();
        res = await vegaEmbed(el, spec, OPTS);
      }
    }
    if (keep) {
      for (const [name, value] of Object.entries(keep)) res.view.signal(name, value);
      await res.view.runAsync();
    }
    // A chart still wider than its card scrolls inside it; its caption then says so.
    const figure = el.closest('figure');
    if (figure) figure.classList.toggle('scrolls', renderedWidth(el) > el.clientWidth);
    views.set(id, { url, spec, view: res.view });
  } catch (err) {
    console.error('chart failed:', id, err);
    el.innerHTML = '<p style="color:#6B6259;font-size:14px">' +
                   'This chart could not be loaded.</p>';
  }
}

// Draw each chart when it comes near the visible part of the page.
const io = new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const hit = CHARTS.find(c => c[0] === e.target.id);
      if (hit) { render(hit[0], hit[1]); obs.unobserve(e.target); }
    }
  }
}, { rootMargin: '400px 0px' });

CHARTS.forEach(([id]) => {
  const el = document.getElementById(id);
  if (el) io.observe(el);
});

// Redraw the charts after the window changes width, keeping each chart's
// control values. A change of height alone is ignored: phone browsers resize
// the window whenever their address bar shows or hides during scrolling.
let t;
let drawnWidth = innerWidth;
addEventListener('resize', () => {
  clearTimeout(t);
  t = setTimeout(() => {
    if (innerWidth === drawnWidth) return;
    drawnWidth = innerWidth;
    views.forEach((v, id) => {
      const keep = controlValues(v.spec, v.view);
      v.view.finalize();
      render(id, v.url, keep);
    });
  }, 250);
});
