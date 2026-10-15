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
               '500 12px Oswald', '600 12px Oswald'];
const fontsReady = Promise.race([
  Promise.all(FONTS.map(font => document.fonts.load(font))),
  new Promise(resolve => setTimeout(resolve, 3000))
]).catch(() => {});

// Chart sizing.
// The width in a spec is the width of the plot only; axes, legends and titles
// add to it. Each chart is drawn, measured, and drawn again with a plot width
// that makes the whole chart fit its card. MIN_PLOT is the narrowest plot width
// used. A chart that is still too wide scrolls inside its card; its plot is then
// widened to the width its titles already take up, so it does not scroll further.
const MIN_PLOT = 160;
const FIT_PASSES = 4;
const FIT_TOLERANCE = 2;

function getPlotWidth(spec) {
  if (typeof spec.width === 'number') return spec.width;
  if (spec.spec && typeof spec.spec.width === 'number') return spec.spec.width;
  return null;
}

// A spec can fix the ratio of its plot height to its plot width with
// "usermeta": {"aspect": ...}; the height then follows every width change.
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

const views = new Map();

// Fetch a spec, embed it in its <div> and fit it to the card.
async function render(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  await fontsReady;
  try {
    const spec = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });

    let plot = getPlotWidth(spec);
    const designed = plot;
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
      const corrected = Math.max(MIN_PLOT, Math.floor(avail - overhead));
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
    views.set(id, { url, view: res.view });
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

// Redraw the charts after the window is resized.
let t;
addEventListener('resize', () => {
  clearTimeout(t);
  t = setTimeout(() => {
    views.forEach((v, id) => { v.view.finalize(); render(id, v.url); });
  }, 250);
});
