// Checks for the data files and the charts.
//
// checks.html runs this file. It checks that the data files are consistent,
// that every map reads its outlines from TopoJSON, and that every chart renders
// without errors. Open checks.html through a local web server, the same way as
// index.html.

// Every chart specification, including the spare tile-grid map.
const SPECS = [
  'specs/14_oscar_timeline.vl.json',
  'specs/01_stacked_area.vl.json',
  'specs/02_world_shares.vl.json',
  'specs/02c_concentration.vl.json',
  'specs/15_filming_dots.vl.json',
  'specs/03_connected_scatter.vl.json',
  'specs/04_ridgeline.vl.json',
  'specs/05_genre_heatmap.vl.json',
  'specs/06_hexbin.vl.json',
  'specs/07_rating_box.vl.json',
  'specs/08_awards_mosaic.vl.json',
  'specs/09_coproduction_map.vl.json',
  'specs/10_malaysia_bump.vl.json',
  'specs/11_malaysia_audience.vl.json',
  'specs/13_malaysia_cinema_map.vl.json',
  'specs/B1_tilegrid.vl.json',
];

// The least number of marks each chart is expected to draw.
const MIN_MARKS = {
  '01_stacked_area': 361,
  '02_world_shares': 296,
  '02c_concentration': 112,
  '03_connected_scatter': 164,
  '04_ridgeline': 378,
  '05_genre_heatmap': 291,
  '06_hexbin': 454,
  '07_rating_box': 63,
  '08_awards_mosaic': 90,
  '09_coproduction_map': 370,
  '10_malaysia_bump': 117,
  '11_malaysia_audience': 52,
  '13_malaysia_cinema_map': 65,
  '14_oscar_timeline': 54,
  '15_filming_dots': 1774,
  'B1_tilegrid': 394,
};

// The decades and the eight source regions used in the data files.
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const REGIONS = ['North America', 'Europe', 'East Asia', 'South & Southeast Asia', 'Latin America',
                 'Middle East & Central Asia', 'Africa', 'Oceania'];

const EMBED_OPTIONS = { actions: false, renderer: 'canvas', tooltip: { theme: 'light' } };
const FONTS = ['400 12px Inter', '500 12px Inter', '600 12px Inter', '500 12px Oswald', '600 12px Oswald'];

// ---- results ---------------------------------------------------------------

const results = [];
const notes = [];
let section = '';

function check(ok, message) {
  results.push({ section, ok: Boolean(ok), message });
}

function note(title, rows) {
  notes.push({ title, rows });
}

// ---- helpers ---------------------------------------------------------------

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

// CSV values are read as text and converted where a number is needed.
async function readCsv(url) {
  return vega.read(await fetchText(url), { type: 'csv' });
}

const num = value => (value === '' || value == null ? NaN : Number(value));
const sum = values => values.reduce((total, v) => total + v, 0);
const mean = values => sum(values) / values.length;
const isInteger = value => /^-?\d+$/.test(String(value).trim());

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = typeof key === 'function' ? key(row) : row[key];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return groups;
}

// Group sums of one column, e.g. the shares in each year.
function groupSums(rows, key, column) {
  return [...groupBy(rows, key).values()].map(group => sum(group.map(r => num(r[column]))));
}

// True when a is within atol of b, with a small allowance relative to b.
const close = (a, b, atol) => Math.abs(a - b) <= atol + 1e-5 * Math.abs(b);

// Shoelace area in longitude and latitude; negative for a clockwise ring.
function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

// True when a point lies inside a ring of longitude and latitude pairs.
function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The geometries of one object in a TopoJSON file.
function geometries(topology, object) {
  return ((topology.objects || {})[object] || {}).geometries || [];
}

function polygonsOf(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

// Every single view of a spec with the data it reads, layers included.
function views(node, data, out = []) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    data = node.data || data;
    if (node.mark) out.push({ mark: node.mark, data, encoding: node.encoding || {}, transform: node.transform || [] });
    for (const key of ['layer', 'spec', 'concat', 'hconcat', 'vconcat']) {
      const child = node[key];
      for (const c of Array.isArray(child) ? child : child ? [child] : []) views(c, data, out);
    }
  }
  return out;
}

// Every data file named anywhere in a spec, lookups included.
function urls(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(n => urls(n, out));
  } else if (node && typeof node === 'object') {
    if (typeof node.url === 'string') out.push(node.url);
    Object.values(node).forEach(v => urls(v, out));
  }
  return out;
}

function countMarks(root) {
  let count = 0;
  const walk = group => {
    if (!group || !group.items) return;
    for (const item of group.items) {
      if (item.marktype) {
        count += item.items ? item.items.length : 0;
        walk(item);
      } else if (item.items) {
        walk(item);
      }
    }
  };
  walk(root);
  return count;
}

const nameOf = path => path.split('/').pop().replace('.vl.json', '');
const fixed = (value, digits) => Number(value).toFixed(digits);

// ---- data checks -----------------------------------------------------------

async function checkData() {
  section = 'Data files';
  const s1 = await readCsv('data/01_stacked_area_region_year.csv');
  const s1Sums = groupSums(s1, 'year', 'share');
  check(s1Sums.every(v => close(v, 1, 1e-3)),
    `stacked area shares sum to 1 per year (min=${fixed(Math.min(...s1Sums), 4)} max=${fixed(Math.max(...s1Sums), 4)})`);
  check(s1.every(r => num(r.year) >= 1970 && num(r.year) <= 2022), 'stacked area years within 1970-2022');
  check(s1.every(r => REGIONS.includes(r.region)), 'stacked area regions are the eight source regions');

  const s2 = await readCsv('data/02_country_shares_decade.csv');
  const s2Sums = groupSums(s2, 'decade', 'share_pct');
  check(s2Sums.every(v => close(v, 100, 0.05)),
    `country shares sum to 100 per decade (min=${fixed(Math.min(...s2Sums), 3)})`);
  check(s2.every(r => isInteger(r.iso_num) && num(r.iso_num) >= 1 && num(r.iso_num) <= 999),
    'country iso_num is an ISO numeric code');

  const s2d = await readCsv('data/02d_country_shares_wide.csv');
  const wide = new Map(s2d.map(r => [num(r.iso_num), r]));
  const cell = (row, decade) => num(row[`d${decade}`]);
  const wideSums = DECADES.map(d => sum(s2d.map(r => cell(r, d)).filter(v => !Number.isNaN(v))));
  check(wideSums.every(v => close(v, 100, 0.05)),
    `wide country shares sum to 100 per decade (min=${fixed(Math.min(...wideSums), 3)})`);
  check(wide.size === s2d.length, 'wide country shares have one row per country or region');
  check(s2d.every(r => REGIONS.includes(r.region)), 'every country or region is in one of the eight source regions');
  const differ = s2.filter(r => !wide.has(num(r.iso_num)) ||
    !close(cell(wide.get(num(r.iso_num)), r.decade), num(r.share_pct), 1e-4));
  const cells = sum(s2d.map(r => DECADES.filter(d => !Number.isNaN(cell(r, d))).length));
  check(differ.length === 0 && cells === s2.length,
    `wide and long country share files hold the same ${s2.length} values`);

  const c2c = await readCsv('data/02c_concentration_by_decade.csv');
  check(c2c.length === 6 && c2c.every(r => num(r.effective_countries) > 1), 'concentration metrics present for 6 decades');

  const s3 = await readCsv('data/03_budget_revenue_year.csv');
  check(s3.length > 0, 'chart 3 present');
  check(s3.every(r => num(r.budget_films) >= 10), 'chart 3: every year has >=10 budget observations in the top-20 cohort');
  check(s3.every(r => num(r.pool) >= 20), "chart 3: every year's revenue pool >= 20 films (fixed-rank cohort valid)");
  check(s3.every(r => num(r.median_budget_musd) >= 1 && num(r.median_budget_musd) <= 400),
    'chart 3: median real budgets plausible (1-400 M USD)');

  const s4 = await readCsv('data/04_ridgeline_budget_decade.csv');
  check(groupSums(s4, 'decade', 'density').every(v => close(v, 1, 1e-4)), 'ridgeline densities sum to 1 per decade (5-dp storage)');

  const s5 = await readCsv('data/05_genre_decade.csv');
  check(groupSums(s5, 'decade', 'share_pct').every(v => close(v, 100, 0.05)), 'genre shares sum to 100 per decade');
  const genres = new Set(s5.map(r => r.genre)).size;
  check(genres === 19, `19 TMDB genres present (${genres})`);

  const s6 = await readCsv('data/06_hexbin_budget_rating.csv');
  const hexFilms = sum(s6.map(r => num(r.films)));
  check(hexFilms > 9000, `hexbin covers ${hexFilms.toLocaleString('en-US')} films`);
  const s6b = await readCsv('data/06b_rating_budget_bands.csv');
  check(sum(s6b.map(r => num(r.films))) === hexFilms, 'budget-range averages cover the same films as the hexbin');
  check(s6b.every((r, i) => i === 0 || num(r.budget_from_usd) === num(s6b[i - 1].budget_to_usd)),
    'budget ranges follow on from each other');
  check(s6b.every(r => num(r.avg_rating) >= 1 && num(r.avg_rating) <= 10), 'budget-range average ratings within 1-10');

  const s7 = await readCsv('data/07_rating_decade_box.csv');
  check(s7.every(r => num(r.q1) <= num(r.median) && num(r.median) <= num(r.q3)), 'box quartiles ordered');
  check(s7.every(r => num(r.median) >= 4 && num(r.median) <= 8), 'box medians in plausible rating range');

  const s8 = await readCsv('data/08_awards_region_decade.csv');
  check(groupSums(s8, 'decade', 'share_pct').every(v => close(v, 100, 0.05)), 'awards shares sum to 100 per decade');
  const coverage = Math.min(...s8.map(r => num(r.coverage_pct)));
  check(s8.every(r => num(r.coverage_pct) >= 90), `awards join coverage >=90% every decade (min=${fixed(coverage, 1)}%)`);
  const s8b = await readCsv('data/08b_awards_mosaic_layout.csv');
  check(s8b.length === s8.length && s8b.every(r => s8.some(a => a.decade === r.decade && a.region === r.region &&
    a.share_pct === r.share_pct)), 'mosaic layout matches the awards shares');

  const s9 = await readCsv('data/09_map_coproduction_links.csv');
  check(s9.every(r => ['a_lon', 'a_lat', 'b_lon', 'b_lat'].every(c => !Number.isNaN(num(r[c])))),
    'co-production links have both endpoints');
  check(s9.every(r => num(r.links) >= 15), 'every co-production pair has at least 15 films');
  const c9b = await readCsv('data/09b_coproduction_region_pairs.csv');
  const c9bTotal = sum(c9b.map(r => num(r.share_pct)));
  check(Math.abs(c9bTotal - 100) < 0.5, `co-production region shares sum to 100 (${fixed(c9bTotal, 1)})`);
  const pairLinks = new Map();
  for (const r of s9) {
    const ends = [num(r.a_num), num(r.b_num)].map(n => (wide.get(n) || {}).region).sort();
    const key = ends.join(' - ');
    pairLinks.set(key, (pairLinks.get(key) || 0) + num(r.links));
  }
  check(c9b.length === pairLinks.size && c9b.every(r => pairLinks.get(r.pair) === num(r.links)),
    'co-production region-pair totals match the links');
  const c9c = await readCsv('data/09c_coproduction_share_decade.csv');
  check(c9c.every(r => num(r.coproduction_pct) >= 5 && num(r.coproduction_pct) <= 60), 'co-production share per decade plausible');

  const s10 = await readCsv('data/10_malaysia_genre_bump.csv');
  check([...groupBy(s10, 'decade').values()].every(g => new Set(g.map(r => r.rank)).size === g.length),
    'Malaysia bump ranks unique per decade');

  const s11 = await readCsv('data/11_malaysia_official_figures.csv');
  check(s11.length > 0 && s11.every(r => !Number.isNaN(num(r.value)) && /^https:\/\/www\.bernama\.com\//.test(r.source)),
    'every official figure has a value and a Bernama source link');
  check(s11.filter(r => r.metric === 'local_share_pct').every(r => num(r.value) > 0 && num(r.value) < 100),
    'local admission shares between 0 and 100%');

  const s13 = await readCsv('data/13_malaysia_cinemas_state.csv');
  check(s13.length === 16, `Malaysia map has 16 states/FTs (${s13.length})`);
  check(s13.every(r => num(r.lat) >= 0.5 && num(r.lat) <= 8 && num(r.lon) >= 99 && num(r.lon) <= 120),
    'state label points inside Malaysia bbox');
  // populations are rounded to thousands and rates to two decimals
  check(s13.filter(r => num(r.cinemas) > 0).every(r => {
    const c = num(r.cinemas), p = num(r.population_m), rate = num(r.per_million);
    return rate >= c / (p + 0.0005) - 0.005 && rate <= c / (p - 0.0005) + 0.005;
  }), 'cinemas per million match the cinema counts and populations');
  const mys = JSON.parse(await fetchText('data/13_malaysia_states.topojson'));
  const objects = Object.keys(mys.objects || {});
  check(mys.type === 'Topology' && objects.length === 1 && objects[0] === 'states',
    "Malaysia state outlines are TopoJSON with one object, 'states'");
  const states = geometries(mys, 'states');
  check(states.length === 16, 'state TopoJSON has 16 states/FTs');
  const topoKeys = new Set(states.map(g => (g.properties || {}).state));
  check(topoKeys.size === s13.length && s13.every(r => topoKeys.has(r.state)), 'TopoJSON state keys match stats keys');

  const s14 = await readCsv('data/14_malaysia_oscar_submissions.csv');
  check(s14.length === 11, `eleven Academy Award submissions (${s14.length})`);
  check(s14.every(r => num(r.ceremony) === num(r.year) - 1927), 'each submission year matches its ceremony number');
  check(s14.every(r => ['Not nominated', 'Result pending'].includes(r.result)), 'every submission has a result');

  const b1 = await readCsv('data/B1_tilegrid_country_films.csv');
  check(new Set(b1.map(r => r.iso_a3)).size === b1.length, 'tile grid iso codes unique');
  check(b1.some(r => String(r.is_malaysia).toLowerCase() === 'true'), 'Malaysia present in tile grid');

  const b2 = await readCsv('data/B2_filming_locations_grid.csv');
  check(b2.every(r => Math.abs(num(r.lat)) <= 90 && Math.abs(num(r.lon)) <= 180), 'filming grid coords valid');
  const shoots = sum(b2.map(r => num(r.shoots)));
  const topPlaces = await readCsv('data/B2_filming_top_places.csv');
  const hubs = await readCsv('data/B2_filming_hubs.csv');
  check(hubs.every(h => topPlaces.some(t => t.locLabel === h.locLabel && t.shoots === h.shoots)),
    'filming map labels match the top filming places');
  const myShoots = await readCsv('data/B2_malaysia_shoots.csv');
  check(myShoots.length === 8, `eight Malaysian filming locations (${myShoots.length})`);

  section = 'Map coverage';
  const world = JSON.parse(await fetchText('data/world-110m.topojson'));
  const outlines = vega.read(JSON.stringify(world), { type: 'topojson', feature: 'countries' });
  const largest = new Map();
  for (const f of outlines) {
    const rings = polygonsOf(f).map(p => p[0]);
    if (f.id != null && rings.length) {
      largest.set(num(f.id), rings.reduce((a, b) => Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
    }
  }
  const placed = DECADES.map(d => sum(s2d.filter(r => Math.abs(num(r.lat)) <= 90 && Math.abs(num(r.lon)) <= 180)
    .map(r => cell(r, d)).filter(v => !Number.isNaN(v))));
  check(Math.min(...placed) > 99.95, `world circle map places 100% of every decade (worst=${fixed(Math.min(...placed), 2)}%)`);
  const withOutline = s2d.filter(r => largest.has(num(r.iso_num)));
  const outside = withOutline.filter(r => !insideRing([num(r.lon), num(r.lat)], largest.get(num(r.iso_num))));
  check(outside.length === 0, `every circle with an outline sits inside its largest outline (${withOutline.length} countries)` +
    `${outside.length ? `; outside: ${outside.map(r => r.country).join(', ')}` : ''}`);
  const noOutline = s2d.filter(r => !largest.has(num(r.iso_num)));
  note('Countries and regions with no outline at this scale, placed at their Wikidata coordinates',
    noOutline.map(r => [r.country, `${r.lon}, ${r.lat}`]));
  check(s9.every(r => wide.has(num(r.a_num)) && wide.has(num(r.b_num))), 'every co-production endpoint is a circle on the world map');
  check(s9.every(r => [['a_num', 'a_lon', 'a_lat'], ['b_num', 'b_lon', 'b_lat']].every(([n, lon, lat]) => {
    const w = wide.get(num(r[n]));
    return w && num(w.lon) === num(r[lon]) && num(w.lat) === num(r[lat]);
  })), 'co-production line ends sit at the same points as the circles');
  const decades = new Set(s10.map(r => r.decade));
  check([...groupBy(s10, 'genre').values()].every(g => new Set(g.map(r => r.decade)).size === decades.size),
    'Malaysia bump lines continuous (no missing decade)');
  check(s13.filter(r => num(r.cinemas) === 0).every(r => r.per_million === ''),
    'under-mapped states carry null (not a false zero)');

  notes.push(...headlines({ s1, s6b, s8, c9b, shoots, topPlaces }));
}

// Figures behind the main claims, shown for reading rather than checked.
function headlines({ s1, s6b, s8, c9b, shoots, topPlaces }) {
  const decadeOf = r => Math.floor(num(r.year) / 10) * 10;
  const na = [...groupBy(s1.filter(r => r.region === 'North America'), decadeOf)]
    .map(([d, g]) => [`${d}s`, `${fixed(mean(g.map(r => num(r.share))) * 100, 1)}%`]);
  const asia = [...groupBy(s1.filter(r => r.region === 'East Asia' || r.region === 'South & Southeast Asia'), decadeOf)]
    .map(([d, g]) => {
      const perYear = groupSums(g, 'year', 'share');
      return [`${d}s`, `${fixed(mean(perYear) * 100, 1)}%`];
    });
  const low = num(s6b[0].avg_rating);
  const high = num(s6b[s6b.length - 1].avg_rating);
  const regions = [...new Set(s8.map(r => r.region))].sort();
  const oscarDecades = [...new Set(s8.map(r => r.decade))].sort();
  const share = (region, decade) => {
    const row = s8.find(r => r.region === region && r.decade === decade);
    return row ? fixed(num(row.share_pct), 1) : '0.0';
  };
  const pairShare = test => fixed(sum(c9b.filter(r => test(r.pair)).map(r => num(r.share_pct))), 1);
  const within = ['Europe - Europe', 'Europe - North America', 'North America - North America'];
  const topShare = n => `${fixed(100 * sum(topPlaces.slice(0, n).map(r => num(r.shoots))) / shoots, 1)}%`;
  return [
    { title: 'North America share of widely seen films, by decade', rows: na },
    { title: 'Asia (East and South & Southeast) share, by decade', rows: asia },
    { title: 'Average rating by budget', rows: [
      ['budgets under $100,000', fixed(low, 2)], ['budgets of $100 million and more', fixed(high, 2)],
      ['difference', `${high - low >= 0 ? '+' : ''}${fixed(high - low, 2)}`]] },
    { title: 'Oscar nominations by region (% of each decade)',
      rows: [['', ...oscarDecades.map(d => `${d}s`)], ...regions.map(g => [g, ...oscarDecades.map(d => share(g, d))])] },
    { title: 'Co-production pairs on the map (% of films co-produced)', rows: [
      ['within Europe and North America', pairShare(p => within.includes(p))],
      ['involving East, South or Southeast Asia', pairShare(p => /East Asia|South & Southeast Asia/.test(p))]] },
    { title: 'Recorded filming locations', rows: [
      ['shoots, 1970-2022', shoots.toLocaleString('en-US')],
      ['top three places', topShare(3)], ['top ten places', topShare(10)]] },
  ];
}

// ---- spec checks -----------------------------------------------------------

// Size in bytes of each data file, or null when it cannot be loaded.
const fileSizes = new Map();

async function fileSize(url) {
  if (!fileSizes.has(url)) {
    let size = null;
    try {
      const response = await fetch(url);
      if (response.ok) size = (await response.arrayBuffer()).byteLength;
    } catch (error) { /* reported as missing */ }
    fileSizes.set(url, size);
  }
  return fileSizes.get(url);
}

async function checkSpecs() {
  section = 'Maps read TopoJSON';
  const missing = [];
  const notTopo = [];
  const used = new Map();
  const lineLayers = [];
  const badLines = [];
  let geoLayers = 0;
  for (const path of SPECS) {
    const spec = JSON.parse(await fetchText(path));
    for (const url of urls(spec)) {
      if (await fileSize(url) === null) missing.push(`${nameOf(path)}: ${url}`);
    }
    for (const view of views(spec)) {
      const type = typeof view.mark === 'string' ? view.mark : view.mark.type;
      if (type !== 'geoshape') continue;
      // A geoshape layer that takes its shape from a field draws lines built from
      // coordinates (the co-production links as great circles), not outlines from a file.
      if (view.encoding.shape) {
        const field = view.encoding.shape.field;
        const built = view.transform.some(t => t.as === field && /LineString/.test(t.calculate || ''));
        (built ? lineLayers : badLines).push(nameOf(path));
        continue;
      }
      geoLayers++;
      const data = view.data || {};
      const format = data.format || {};
      let objectsInFile = {};
      try { objectsInFile = JSON.parse(await fetchText(data.url)).objects || {}; } catch (e) { /* reported below */ }
      if (format.type !== 'topojson' || !(format.feature in objectsInFile)) {
        notTopo.push(`${nameOf(path)}: ${data.url}`);
      } else {
        used.set(`${data.url}|${format.feature}`, { url: data.url, feature: format.feature });
      }
    }
  }
  check(SPECS.length > 0 && missing.length === 0,
    `every data file the ${SPECS.length} specs reference exists${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
  check(geoLayers > 0 && notTopo.length === 0,
    `all ${geoLayers} map outline layers read a TopoJSON object${notTopo.length ? `; not TopoJSON: ${notTopo.join(', ')}` : ''}`);
  check(badLines.length === 0,
    `${lineLayers.length} geoshape layer draws great-circle lines it builds from coordinates (${lineLayers.join(', ')})` +
    `${badLines.length ? `; shape not built from coordinates: ${badLines.join(', ')}` : ''}`);
  check([...fileSizes.keys()].every(u => !/\.geojson$/i.test(u)), 'no chart reads a GeoJSON file');
  for (const { url, feature } of [...used.values()].sort((a, b) => a.url.localeCompare(b.url))) {
    const features = vega.read(await fetchText(url), { type: 'topojson', feature });
    const polygons = features.flatMap(polygonsOf);
    const wrong = polygons.filter(rings => rings.some((ring, k) => (signedArea(ring) >= 0) === (k === 0))).length;
    check(polygons.length > 0 && wrong === 0,
      `${url} '${feature}': outer rings clockwise, holes counter-clockwise (${polygons.length} polygons)`);
  }

  section = 'Page data';
  const sizes = [...fileSizes].filter(([, bytes]) => bytes !== null).sort(([a], [b]) => a.localeCompare(b));
  const total = sum(sizes.map(([, bytes]) => bytes));
  check(total < 2 * 1024 * 1024, `chart data under 2 MB (${fixed(total / 1024, 1)} KB in ${sizes.length} files)`);
  note('Data files the charts load', sizes.map(([url, bytes]) => [url, `${fixed(bytes / 1024, 1)} KB`]));
}

// Draw every chart, then check it rendered cleanly.
async function checkCharts() {
  section = 'Charts';
  await Promise.all(FONTS.map(font => document.fonts.load(font)));
  const container = document.getElementById('charts');
  for (const path of SPECS) {
    const name = nameOf(path);
    const figure = document.createElement('figure');
    const target = document.createElement('div');
    const caption = document.createElement('figcaption');
    figure.append(target, caption);
    container.append(figure);

    const messages = [];
    const logger = vega.logger(vega.Warn, null, (method, level, args) => {
      messages.push(`${level} ${[...args].map(String).join(' ')}`);
    });
    let marks = 0;
    let empty = [];
    try {
      const spec = JSON.parse(await fetchText(path));
      const result = await vegaEmbed(target, spec, { ...EMBED_OPTIONS, logger });
      await result.view.runAsync();
      marks = countMarks(result.view.scenegraph().root);
      empty = (result.vgSpec.data || []).filter(d => d.url && result.view.data(d.name).length === 0).map(d => d.url);
      const link = document.createElement('a');
      link.textContent = `Save ${name}.png`;
      link.download = `${name}.png`;
      link.href = await result.view.toImageURL('png');
      caption.append(link);
    } catch (error) {
      messages.push(`ERROR ${error.message}`);
    }
    check(messages.length === 0, `${name}: renders without errors or warnings${messages.length ? `; ${messages.join(' | ')}` : ''}`);
    check(empty.length === 0, `${name}: every data file it loads has rows${empty.length ? `; empty: ${empty.join(', ')}` : ''}`);
    const least = MIN_MARKS[name] ?? 1;
    check(marks >= least, `${name}: draws ${marks} marks (at least ${least} expected)`);
  }
}

// ---- report ----------------------------------------------------------------

function report() {
  const failed = results.filter(r => !r.ok);
  const summary = document.getElementById('summary');
  summary.textContent = `${results.length} checks, ${failed.length} failed.`;
  summary.className = failed.length ? 'fail' : 'ok';

  const out = document.getElementById('results');
  for (const [name, rows] of groupBy(results, 'section')) {
    const heading = document.createElement('h2');
    heading.textContent = name;
    const list = document.createElement('ul');
    for (const r of rows) {
      const item = document.createElement('li');
      item.className = r.ok ? 'ok' : 'fail';
      item.textContent = `${r.ok ? 'ok' : 'FAIL'}  ${r.message}`;
      list.append(item);
    }
    out.append(heading, list);
  }
  for (const n of notes) {
    const heading = document.createElement('h3');
    heading.textContent = n.title;
    const table = document.createElement('table');
    for (const row of n.rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      table.append(tr);
    }
    out.append(heading, table);
  }
  window.checkResults = { results, notes, done: true };
}

async function run() {
  try {
    await checkData();
    await checkSpecs();
    await checkCharts();
  } catch (error) {
    section = 'Errors';
    check(false, `checks stopped: ${error.message}`);
  }
  report();
}

run();
