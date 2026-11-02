import { Estimator, formatOption } from "./predict.js";

/* ------------------------------------------------------------------ helpers */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (value) => "$" + Math.round(Number(value) || 0).toLocaleString("en-US");
const moneyShort = (value) => {
  const v = Number(value) || 0;
  if (Math.abs(v) >= 1000) return "$" + Math.round(v / 1000) + "k";
  return "$" + Math.round(v);
};
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const lerp = (a, b, t) => a + (b - a) * t;
const pct = (value, digits = 0) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(digits)}%`;
const plainPct = (value, digits = 0) => `${Math.abs(value * 100).toFixed(digits)}%`;
const fmtInt = (value) => Math.round(Number(value) || 0).toLocaleString("en-US");
const cap = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const hex = pa.map((v, i) => Math.round(lerp(v, pb[i], t)).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function storeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable */
  }
}

/* --------------------------------------------------------------- load model */

const loaderNote = $("#loader-note");
const loaderBar = $("#loader-progress");
loaderBar.style.width = "16%";
loaderNote.textContent = "Reading the model bundle…";

let bundle;
try {
  const response = await fetch("./model.json");
  if (!response.ok) throw new Error(`model.json returned ${response.status}`);
  bundle = await response.json();
  loaderBar.style.width = "72%";
  loaderNote.textContent = "Mapping 245 signals…";
} catch (error) {
  loaderBar.style.width = "100%";
  loaderBar.style.background = "#a3756a";
  loaderNote.textContent = "The model could not be loaded. Please refresh the page.";
  console.error(error);
  throw error;
}

const est = new Estimator(bundle);

/* ------------------------------------------------------------------ constants */

const ESSENTIALS = [
  "Neighborhood", "HouseStyle", "OverallQual", "GrLivArea", "YearBuilt",
  "BedroomAbvGr", "FullBath", "GarageCars", "GarageType", "TotalBsmtSF",
  "KitchenQual", "ExterQual", "Fireplaces", "LotArea",
];
const HIDDEN = new Set(["1stFlrSF"]);
const SLIDER = new Set([
  "OverallQual", "OverallCond", "YearBuilt", "YearRemodAdd", "YrSold", "MoSold",
  "GrLivArea", "LotArea", "LotFrontage", "TotalBsmtSF", "GarageArea", "GarageCars",
  "BedroomAbvGr", "FullBath", "HalfBath", "BsmtFullBath", "BsmtHalfBath",
  "Fireplaces", "KitchenAbvGr", "TotRmsAbvGrd", "2ndFlrSF", "LowQualFinSF",
  "WoodDeckSF", "OpenPorchSF", "EnclosedPorch", "3SsnPorch", "ScreenPorch",
  "PoolArea", "MasVnrArea", "BsmtFinSF1", "BsmtFinSF2", "BsmtUnfSF", "GarageYrBlt",
]);
const RANGES = {
  GrLivArea: [300, 6000, 25], LotArea: [1000, 50000, 250], LotFrontage: [0, 250, 5],
  TotalBsmtSF: [0, 4000, 25], GarageArea: [0, 1500, 20], GarageCars: [0, 4, 1],
  MasVnrArea: [0, 1600, 10], PoolArea: [0, 800, 10], MiscVal: [0, 12000, 100],
  YearBuilt: [1870, 2011, 1], YearRemodAdd: [1950, 2011, 1], GarageYrBlt: [1900, 2011, 1],
  YrSold: [2006, 2010, 1], MoSold: [1, 12, 1], "2ndFlrSF": [0, 3000, 25],
  LowQualFinSF: [0, 800, 10], BsmtFinSF1: [0, 3000, 10], BsmtFinSF2: [0, 1500, 10],
  BsmtUnfSF: [0, 2500, 10], WoodDeckSF: [0, 900, 10], OpenPorchSF: [0, 600, 10],
  EnclosedPorch: [0, 600, 10], "3SsnPorch": [0, 500, 10], ScreenPorch: [0, 500, 10],
  TotRmsAbvGrd: [2, 14, 1], BedroomAbvGr: [0, 8, 1],
};
const QUICK = [
  { field: "OverallQual", label: "Quality", min: 1, max: 10, step: 1, fmt: (v) => `${v} / 10` },
  { field: "GrLivArea", label: "Living area", min: 300, max: 6000, step: 25, fmt: (v) => `${fmtInt(v)} sq ft` },
  { field: "YearBuilt", label: "Year built", min: 1870, max: 2011, step: 1, fmt: (v) => `${Math.round(v)}` },
  { field: "BedroomAbvGr", label: "Bedrooms", min: 0, max: 8, step: 1, fmt: (v) => `${Math.round(v)}` },
];
const PIN_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9"></path><path d="M6.6 8.6L10 12l3.4-3.4"></path><path d="M4 16h12"></path></svg>`;

const INITIAL_PRESET = bundle.presets.find((preset) => preset.key === "family") || bundle.presets[0];
const state = {
  house: structuredClone(INITIAL_PRESET?.house || bundle.defaults),
  view: "studio",
  activeExplain: "drivers",
  scenarios: Array.isArray(loadJSON("novaestate.atelier.scenarios", [])) ? loadJSON("novaestate.atelier.scenarios", []) : [],
  compare: loadJSON("novaestate.atelier.compare", null),
  lastPrice: 0,
  levers: [],
  presetKey: INITIAL_PRESET?.key || null,
};

let priceAnimation = 0;
let toastTimer = 0;
let sensPoints = null;
let scatterGeom = null;
let scatterHover = null;
let paletteItems = [];
let paletteFiltered = [];
let paletteActive = 0;

/* ------------------------------------------------------------------- format */

function formatField(field, value, short = false) {
  if (bundle.categories[field]) {
    if (short) return String(value);
    return formatOption(bundle, field, value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (bundle.int_fields.includes(field)) return Math.round(n).toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function houseBaths(house) {
  return (
    num(house.FullBath) +
    num(house.BsmtFullBath) +
    0.5 * (num(house.HalfBath) + num(house.BsmtHalfBath))
  );
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/* ------------------------------------------------------------------- forms */

function controlHTML(field) {
  const value = state.house[field] ?? bundle.defaults[field];
  const label = bundle.labels[field] || field;
  const description = bundle.descriptions?.[field] || label;
  if (bundle.categories[field]) {
    const options = bundle.categories[field]
      .map((option) => {
        const selected = String(option) === String(value) ? " selected" : "";
        return `<option value="${esc(option)}"${selected}>${esc(formatOption(bundle, field, option))}</option>`;
      })
      .join("");
    return `<label class="field" data-field-label="${esc((label + " " + field + " " + description).toLowerCase())}" title="${esc(description)}"><span class="flabel">${esc(label)}</span><select data-field="${field}">${options}</select></label>`;
  }

  const stats = bundle.numeric_stats[field];
  if (!stats) return "";
  const [lo, hi, step] = RANGES[field] || [
    Math.floor(stats.min),
    Math.ceil(stats.max),
    bundle.int_fields.includes(field) ? 1 : 10,
  ];
  const safe = clamp(num(value, stats.median), lo, hi);
  const meta = `data-field-label="${esc((label + " " + field + " " + description).toLowerCase())}" title="${esc(description)}"`;
  if (SLIDER.has(field)) {
    return `<label class="field" ${meta}><span class="flabel">${esc(label)} <em data-out="${field}"></em></span>
      <input type="range" data-field="${field}" min="${lo}" max="${hi}" step="${step}" value="${Math.round(safe)}"></label>`;
  }
  return `<label class="field" ${meta}><span class="flabel">${esc(label)}</span>
    <input type="number" data-field="${field}" min="${lo}" max="${hi}" step="${step}" value="${safe}"></label>`;
}

function buildForms() {
  $("#form-essentials").innerHTML = ESSENTIALS.map(controlHTML).join("");

  const advanced = [];
  for (const group of bundle.groups) {
    const fields = (bundle.group_fields[group] || []).filter(
      (field) => bundle.input_columns.includes(field) && !HIDDEN.has(field) && !ESSENTIALS.includes(field)
    );
    if (!fields.length) continue;
    advanced.push(
      `<details class="group"><summary>${esc(group)} <em>${fields.length} fields</em></summary>
        <div class="form-grid">${fields.map(controlHTML).join("")}</div></details>`
    );
  }
  $("#form-advanced").innerHTML = advanced.join("");

  $("#presets").innerHTML = bundle.presets
    .map(
      (preset) => `<button class="preset" data-preset="${preset.key}" data-preset-key="${preset.key}">
        <b>${esc(preset.name)}</b><small>${esc(preset.tagline)}</small></button>`
    )
    .join("") +
    `<button class="preset surprise" data-preset="surprise" data-preset-key="surprise">
      <b><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="4"></rect><circle cx="7.5" cy="7.5" r="1"></circle><circle cx="12.5" cy="12.5" r="1"></circle><circle cx="12.5" cy="7.5" r="1"></circle><circle cx="7.5" cy="12.5" r="1"></circle></svg>Surprise me</b>
      <small>A real recorded sale, replayed.</small></button>`;

  const sensitivityFields = Object.keys(bundle.numeric_stats).filter(
    (field) => !["YrSold", "MoSold", "IsRemodeled", "IsNew"].includes(field)
  );
  const preferred = [
    "GrLivArea", "LotArea", "OverallQual", "YearBuilt", "TotalBsmtSF",
    "GarageArea", "Fireplaces", "TotRmsAbvGrd", "LotFrontage", "OverallCond",
  ].filter((field) => sensitivityFields.includes(field));
  const ordered = [...preferred, ...sensitivityFields.filter((f) => !preferred.includes(f))];
  $("#sens-feature").innerHTML = ordered
    .map((field) => `<option value="${field}">${esc(bundle.labels[field] || field)}</option>`)
    .join("");

  const quick = QUICK.map(
    (item) => `<label class="quick">
      <div class="quick-top"><span>${esc(item.label)}</span><b data-quick-out="${item.field}">—</b></div>
      <input type="range" data-quick="${item.field}" min="${item.min}" max="${item.max}" step="${item.step}" value="${clamp(num(state.house[item.field], item.min), item.min, item.max)}" aria-label="${esc(item.label)}">
    </label>`
  ).join("");
  $("#quick-controls").innerHTML = quick;

  const hoodSelect = $("#hood-switch");
  hoodSelect.innerHTML = bundle.categories.Neighborhood
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
    .join("");
}

function updateOutput(field) {
  const out = $(`[data-out="${field}"]`);
  if (!out) return;
  out.textContent = formatField(field, state.house[field]);
}

function syncForm() {
  $$("#view-studio [data-field]").forEach((el) => {
    const field = el.dataset.field;
    const value = state.house[field] ?? bundle.defaults[field];
    if (el.tagName === "SELECT") el.value = String(value);
    else if (document.activeElement !== el) el.value = value;
    updateOutput(field);
  });
}

function syncQuick() {
  QUICK.forEach((item) => {
    const value = num(state.house[item.field], bundle.defaults[item.field]);
    const out = $(`[data-quick-out="${item.field}"]`);
    if (out) out.textContent = item.fmt(value);
    const input = $(`[data-quick="${item.field}"]`);
    if (input && document.activeElement !== input) input.value = clamp(value, item.min, item.max);
  });
  $("#hood-switch").value = String(state.house.Neighborhood);
}

function handleControl(el) {
  const field = el.dataset.field;
  if (!field) return;
  let value = el.tagName === "SELECT" ? el.value : Number(el.value);
  if (el.type === "number" && el.value === "") value = bundle.defaults[field];
  state.house[field] = value;
  state.presetKey = null;
  updateOutput(field);
  schedule();
}

/* -------------------------------------------------------------------- hero */

function renderHeroFacts() {
  const median = [...bundle.market].map((row) => row.p).sort((a, b) => a - b)[Math.floor(bundle.market.length / 2)];
  $("#hero-facts").innerHTML = [
    ["Homes read", Number(bundle.metrics.n_total).toLocaleString("en-US")],
    ["Median sale", money(median)],
    ["Validation R²", Number(bundle.metrics.r2).toFixed(3)],
    ["Neighbourhoods", bundle.neighborhoods.length],
  ]
    .map(([k, v]) => `<span class="fact">${esc(k)} <b>${esc(v)}</b></span>`)
    .join("");
}

function qualityAdjective(q) {
  if (q >= 8) return "A refined";
  if (q >= 7) return "A well-built";
  if (q >= 5) return "A steady";
  return "A modest";
}

function storyWord(style) {
  const s = String(style);
  if (s.includes("2")) return "two-storey";
  if (s.includes("1.5")) return "one-and-a-half-storey";
  return "single-storey";
}

function portraitTitle(clean) {
  const quality = Math.round(num(clean.OverallQual, 6));
  return `${qualityAdjective(quality)} ${storyWord(clean.HouseStyle)} home in ${clean.Neighborhood}`;
}

/* ---------------------------------------------------------------- portrait */

function portraitSVG(clean) {
  const W = 640;
  const H = 380;
  const ground = 318;

  const q = clamp(num(clean.OverallQual, 6), 1, 10);
  const t = (q - 1) / 9;
  const area = clamp(num(clean.GrLivArea, 1500), 300, 6000);
  const w = clamp(160 + area * 0.058, 215, 335);
  const style = String(clean.HouseStyle || "1Story");
  const stories = style.includes("2") ? 2 : style.includes("1.5") ? 1.5 : 1;
  const bodyH = 78 + stories * 44;
  const x = 118;
  const bodyY = ground - bodyH;
  const roofH = 46;
  const wall = mixHex("#ddd5c6", "#f4efe3", t);
  const wallShade = mixHex("#cec5b4", "#e7e0d1", t);
  const roof = mixHex("#84907f", "#4b6657", t);
  const roofEdge = mixHex("#6f7d6e", "#3e594b", t);
  const trim = "#f8f5ec";
  const glass = mixHex("#93a9b2", "#6d8a79", t);
  const garageCars = clamp(Math.round(num(clean.GarageCars, 0)), 0, 4);
  const gw = garageCars ? 74 + Math.min(garageCars, 3) * 8 : 0;
  const gx = x + w;
  const gh = 72;
  const beds = clamp(Math.round(num(clean.BedroomAbvGr, 3)), 0, 8);
  const fireplaces = clamp(Math.round(num(clean.Fireplaces, 0)), 0, 5);
  const deck = num(clean.WoodDeckSF, 0);
  const pool = num(clean.PoolArea, 0);
  const lot = num(clean.LotArea, 9000);
  const treeCount = lot >= 15000 ? 2 : lot >= 8000 ? 1 : 0;

  const part = (field, tip, content) =>
    `<g class="house-part" data-jump="${field}" data-tip="${esc(tip)}" tabindex="0" role="button" aria-label="${esc(tip)}"><title>${esc(tip)}</title>${content}</g>`;

  let windows = "";
  const winRows = stories >= 2 ? 2 : 1;
  const winCols = w > 288 ? 3 : 2;
  const winW = 23;
  const winH = 27;
  for (let row = 0; row < winRows; row += 1) {
    for (let col = 0; col < winCols; col += 1) {
      const cx = x + ((col + 1) * w) / (winCols + 1);
      if (row === winRows - 1 && Math.abs(cx - (x + w / 2)) < 30) continue;
      const wy = bodyY + 12 + row * 38;
      windows += `<g>
        <rect x="${cx - winW / 2}" y="${wy}" width="${winW}" height="${winH}" rx="1.5" fill="${trim}"/>
        <rect x="${cx - winW / 2 + 3}" y="${wy + 3}" width="${winW - 6}" height="${winH - 6}" fill="${glass}"/>
        <line x1="${cx}" y1="${wy + 3}" x2="${cx}" y2="${wy + winH - 3}" stroke="${trim}" stroke-width="1.4"/>
        <line x1="${cx - winW / 2 + 3}" y1="${wy + winH / 2}" x2="${cx + winW / 2 - 3}" y2="${wy + winH / 2}" stroke="${trim}" stroke-width="1.2"/>
        <rect x="${cx - winW / 2 - 2}" y="${wy + winH}" width="${winW + 4}" height="3" fill="${trim}" opacity="0.85"/>
      </g>`;
    }
  }

  let chimney = "";
  if (fireplaces > 0) {
    const cx = x + w * 0.72;
    const roofAt = bodyY - roofH * 0.56;
    const top = roofAt - 26;
    chimney = `<g>
      <rect x="${cx - 9}" y="${top}" width="18" height="46" fill="${wallShade}" stroke="${roofEdge}" stroke-width="1"/>
      <rect x="${cx - 12}" y="${top - 4}" width="24" height="6" fill="${roofEdge}"/>
      <circle class="smoke" cx="${cx}" cy="${top - 8}" r="4" fill="#b9bfb7" opacity="0"/>
      <circle class="smoke" cx="${cx + 2}" cy="${top - 14}" r="5" fill="#c4c8c1" opacity="0"/>
      <circle class="smoke" cx="${cx - 2}" cy="${top - 21}" r="6" fill="#ced0ca" opacity="0"/>
    </g>`;
  }

  const garage = garageCars
    ? `<g>
        <rect class="hit" x="${gx - 2}" y="${ground - gh - 12}" width="${gw + 4}" height="${gh + 14}" pointer-events="all"/>
        <rect x="${gx}" y="${ground - gh}" width="${gw}" height="${gh}" fill="${wallShade}" stroke="${roofEdge}" stroke-width="1"/>
        <path d="M${gx - 5} ${ground - gh} L${gx + gw * 0.5} ${ground - gh - 13} L${gx + gw + 5} ${ground - gh} Z" fill="${roof}" stroke="${roofEdge}" stroke-width="1"/>
        <rect x="${gx + 10}" y="${ground - 54}" width="${gw - 20}" height="50" fill="${trim}" stroke="${roofEdge}" stroke-width="0.8"/>
        ${[0, 1, 2, 3].map((i) => `<line x1="${gx + 12}" y1="${ground - 44 + i * 11}" x2="${gx + gw - 12}" y2="${ground - 44 + i * 11}" stroke="${roofEdge}" stroke-width="1" opacity="0.55"/>`).join("")}
        <rect x="${gx + 10}" y="${ground - 54}" width="${gw - 20}" height="4" fill="${roofEdge}" opacity="0.5"/>
      </g>`
    : "";

  const deckMarkup = deck > 0
    ? `<g>
        <rect class="hit" x="${x - 62}" y="${ground - 26}" width="60" height="34" pointer-events="all"/>
        <rect x="${x - 56}" y="${ground - 14}" width="54" height="10" fill="#c9b79c" stroke="#9d8a72" stroke-width="1"/>
        <rect x="${x - 56}" y="${ground - 22}" width="4" height="20" fill="#b5a389"/>
        <rect x="${x - 6}" y="${ground - 22}" width="4" height="20" fill="#b5a389"/>
        <line x1="${x - 56}" y1="${ground - 20}" x2="${x - 2}" y2="${ground - 20}" stroke="#b5a389" stroke-width="2"/>
        ${[0, 1, 2].map((i) => `<line x1="${x - 48 + i * 16}" y1="${ground - 20}" x2="${x - 48 + i * 16}" y2="${ground - 13}" stroke="#b5a389" stroke-width="1.2"/>`).join("")}
      </g>`
    : "";

  const poolMarkup = pool > 0
    ? `<g>
        <ellipse class="hit" cx="92" cy="344" rx="52" ry="21" pointer-events="all"/>
        <ellipse cx="92" cy="344" rx="46" ry="16" fill="#a9c3c8" stroke="#8aa8ae" stroke-width="1.5"/>
        <ellipse cx="92" cy="344" rx="36" ry="10" fill="#bcd4d6"/>
        <path d="M62 341 q8 -4 16 0 t16 0 t16 0" fill="none" stroke="#e8f0ee" stroke-width="1.4" opacity="0.8"/>
      </g>`
    : "";

  const treePositions = [[54, ground], [592, ground]];
  const trees = treePositions
    .slice(0, treeCount)
    .map(([tx, ty], i) => {
      const scale = i === 0 ? 1 : 0.85;
      return `<g class="tree" opacity="${i === 0 ? 0.95 : 0.8}">
        <rect x="${tx - 3 * scale}" y="${ty - 30 * scale}" width="${6 * scale}" height="${30 * scale}" fill="#8b7a63"/>
        <circle cx="${tx}" cy="${ty - 42 * scale}" r="${18 * scale}" fill="${mixHex("#93ab93", "#6f8b79", t)}"/>
        <circle cx="${tx - 13 * scale}" cy="${ty - 30 * scale}" r="${13 * scale}" fill="${mixHex("#87a189", "#64806d", t)}"/>
        <circle cx="${tx + 13 * scale}" cy="${ty - 31 * scale}" r="${14 * scale}" fill="${mixHex("#9ab29a", "#758f7d", t)}"/>
      </g>`;
    })
    .join("");

  const doorX = x + w / 2 - 14;
  const walkway = `<path d="M${doorX - 6} ${ground} L${doorX + 34} ${ground} L${doorX + 52} ${H} L${doorX - 24} ${H} Z" fill="#d7cfbe" opacity="0.9"/>`;
  const driveway = garageCars
    ? `<path d="M${gx + 8} ${ground} L${gx + gw - 8} ${ground} L${gx + gw + 26} ${H} L${gx - 10} ${H} Z" fill="#cfc7b6" opacity="0.75"/>`
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Illustration of the current home">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e7eee7"/><stop offset="58%" stop-color="#f1ede2"/><stop offset="100%" stop-color="#ece3d4"/>
      </linearGradient>
      <linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d9d1bf"/><stop offset="100%" stop-color="#cfc5b1"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle class="sun-halo" cx="524" cy="68" r="34" fill="#e9dcc2" opacity="0.55"/>
    <circle cx="524" cy="68" r="19" fill="#e5d3b2"/>
    <g class="cloud" opacity="0.55" fill="#fbfaf4">
      <ellipse cx="208" cy="66" rx="44" ry="11"/><ellipse cx="232" cy="59" rx="28" ry="10"/>
    </g>
    <g class="cloud slow" opacity="0.38" fill="#fbfaf4">
      <ellipse cx="412" cy="104" rx="56" ry="12"/><ellipse cx="440" cy="97" rx="30" ry="10"/>
    </g>
    <path d="M0 300 Q120 262 250 292 T640 286 L640 ${H} L0 ${H} Z" fill="#d5ddcd" opacity="0.7"/>
    <path d="M0 312 Q160 286 320 304 T640 300 L640 ${H} L0 ${H} Z" fill="url(#lawn)"/>
    ${driveway}${walkway}
    ${part("OverallQual", `Quality ${q}/10 — click to tune`, `
      <rect class="hit" x="${x - 17}" y="${bodyY - roofH - 4}" width="${w + 34}" height="${bodyH + roofH + 6}" pointer-events="all"/>
      <rect x="${x}" y="${bodyY}" width="${w}" height="${bodyH}" rx="2" fill="${wall}" stroke="${roofEdge}" stroke-width="1.2"/>
      <rect x="${x}" y="${bodyY}" width="${w}" height="${bodyH}" fill="none" stroke="${trim}" stroke-width="2" opacity="0.35"/>
      ${stories >= 2 ? `<line x1="${x}" y1="${bodyY + bodyH * 0.46}" x2="${x + w}" y2="${bodyY + bodyH * 0.46}" stroke="${roofEdge}" stroke-width="1.4" opacity="0.45"/>` : ""}
      <path d="M${x - 16} ${bodyY} L${x + w / 2} ${bodyY - roofH} L${x + w + 16} ${bodyY} Z" fill="${roof}" stroke="${roofEdge}" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M${x + w / 2} ${bodyY - roofH} L${x + w / 2} ${bodyY}" stroke="${roofEdge}" stroke-width="1" opacity="0.35"/>
      <rect x="${x - 16}" y="${bodyY - 3}" width="${w + 32}" height="5" fill="${trim}" opacity="0.9"/>
    `)}
    ${part("BedroomAbvGr", `${beds} bedrooms — click to tune`, `
      <rect class="hit" x="${x + 4}" y="${bodyY + 4}" width="${w - 8}" height="${winRows * 38 + 6}" pointer-events="all"/>
      ${windows}
    `)}
    ${part("FullBath", `${houseBaths(clean)} bathrooms — click to tune`, `
      <rect class="hit" x="${doorX - 6}" y="${ground - 56}" width="40" height="58" pointer-events="all"/>
      <rect x="${doorX}" y="${ground - 48}" width="28" height="48" rx="1.5" fill="${trim}" stroke="${roofEdge}" stroke-width="1"/>
      <rect x="${doorX + 4}" y="${ground - 44}" width="20" height="17" fill="${glass}" opacity="0.7"/>
      <circle cx="${doorX + 22}" cy="${ground - 24}" r="1.6" fill="${roofEdge}"/>
      <rect x="${doorX - 5}" y="${ground - 3}" width="38" height="3" fill="${roofEdge}" opacity="0.4"/>
    `)}
    ${garageCars ? part("GarageCars", `${garageCars} garage spaces — click to tune`, garage) : ""}
    ${fireplaces > 0 ? part("Fireplaces", `${fireplaces} fireplace${fireplaces > 1 ? "s" : ""} — click to tune`, chimney) : ""}
    ${deck > 0 ? part("WoodDeckSF", `${fmtInt(deck)} sq ft deck — click to tune`, deckMarkup) : ""}
    ${pool > 0 ? part("PoolArea", `${fmtInt(pool)} sq ft pool — click to tune`, poolMarkup) : ""}
    ${treeCount ? part("LotArea", `${fmtInt(lot)} sq ft lot — click to tune`, trees) : ""}
    <g opacity="0.5" stroke="${mixHex("#8fa78f", "#6f8a78", t)}" stroke-width="1.2" fill="none">
      <path d="M${x + 30} ${ground + 6} q4 -7 8 0"/><path d="M${x + 42} ${ground + 10} q4 -6 8 0"/>
      <path d="M${gx + gw - 30} ${ground + 8} q4 -6 8 0"/>
    </g>
  </svg>`;
}

function renderPortrait(clean) {
  const stage = $("#portrait");
  stage.innerHTML = portraitSVG(clean) + `<div class="portrait-tip" id="portrait-tip" aria-hidden="true"></div>`;
  $("#portrait-title").textContent = portraitTitle(clean);
  $("#hero-chips").innerHTML = [
    `<span class="p-chip"><b>${Math.round(num(clean.GrLivArea))}</b> sq ft</span>`,
    `<span class="p-chip"><b>${Math.round(num(clean.BedroomAbvGr))}</b> bed · <b>${houseBaths(clean)}</b> bath</span>`,
    `<span class="p-chip"><b>Q${Math.round(num(clean.OverallQual))}</b>/10</span>`,
  ].join("");
}

/* --------------------------------------------------------------- animation */

function animatePrice(target) {
  const valueEl = $("#price-value");
  const heroEl = $("#hero-price");
  const from = state.lastPrice;
  state.lastPrice = target;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    valueEl.textContent = money(target);
    heroEl.textContent = money(target);
    return;
  }
  const token = ++priceAnimation;
  const start = performance.now();
  const duration = 520;
  const step = (now) => {
    if (token !== priceAnimation) return;
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const value = money(from + (target - from) * eased);
    valueEl.textContent = value;
    heroEl.textContent = value;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let framePending = false;
function schedule() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    renderStudio();
  });
}

function estimate() {
  const clean = est.sanitize(state.house);
  const price = est.predict(clean);
  const [low, high] = est.band(price);
  return { clean, price, low, high };
}

/* ------------------------------------------------------------------ presets */

function applyPreset(key) {
  if (key === "surprise") {
    surprise();
    return;
  }
  const preset = bundle.presets.find((item) => item.key === key);
  if (!preset) return;
  state.house = structuredClone(preset.house);
  state.presetKey = key;
  syncForm();
  syncQuick();
  renderStudio();
  toast(`${preset.name} — repriced in place`);
}

function resetHome() {
  state.house = { ...bundle.defaults };
  state.presetKey = null;
  syncForm();
  syncQuick();
  renderStudio();
  toast("Back to a typical Ames home");
}

function surprise() {
  const row = bundle.market[Math.floor(Math.random() * bundle.market.length)];
  const quality = clamp(row.q, 1, 10);
  const seeds = {
    ...bundle.defaults,
    Neighborhood: row.n,
    OverallQual: quality,
    OverallCond: row.oc || 5,
    GrLivArea: row.a,
    YearBuilt: row.y,
    YearRemodAdd: Math.min(2011, row.y + (Math.random() < 0.35 ? 12 : 0)),
    TotalBsmtSF: row.b,
    BsmtFinSF1: Math.round(row.b * 0.42),
    BsmtFinType1: row.b > 0 ? "GLQ" : "Unf",
    GarageArea: row.g,
    GarageCars: row.g > 0 ? clamp(Math.round(row.g / 240), 1, 3) : 0,
    GarageType: row.g > 0 ? "Attchd" : "NA",
    FullBath: clamp(row.f || 1, 1, 3),
    BedroomAbvGr: clamp(Math.round(row.a / 480), 1, 6),
    LotArea: row.l,
    HouseStyle: row.s,
    Fireplaces: row.fp,
    FireplaceQu: row.fp > 0 ? "TA" : "NA",
    TotRmsAbvGrd: row.tr || 6,
    "2ndFlrSF": String(row.s).includes("2") ? Math.round(row.a * 0.36) : 0,
    KitchenQual: quality >= 8 ? "Gd" : quality >= 6 ? "TA" : "Fa",
    ExterQual: quality >= 8 ? "Gd" : quality >= 6 ? "TA" : "Fa",
    MasVnrType: quality >= 7 && Math.random() < 0.4 ? "BrkFace" : "NA",
    MasVnrArea: quality >= 7 && Math.random() < 0.4 ? 120 : 0,
  };
  state.house = seeds;
  state.presetKey = "surprise";
  syncForm();
  syncQuick();
  renderStudio();
  toast(`A recorded sale in ${row.n} — $${row.p.toLocaleString("en-US")} in ${row.y}`);
}

/* ------------------------------------------------------------------ studio */

function renderStudio() {
  const { clean, price, low, high } = estimate();
  const area = num(clean.GrLivArea, 1500);
  const quality = Math.round(num(clean.OverallQual, 6));
  const comps = est.comps(clean, 6);
  const hood = est.neighborhood(clean);
  const ppsf = price / Math.max(area, 1);
  const compMedian = comps.length
    ? comps.map((row) => row.price).sort((a, b) => a - b)[Math.floor(comps.length / 2)]
    : price;
  const gap = compMedian ? price / compMedian - 1 : 0;
  const confidence = num(bundle.metrics.within_10, 75);

  $("#price-range").textContent = `Likely range ${money(low)} – ${money(high)}`;
  $("#hero-range").textContent = `${money(low)} – ${money(high)}`;
  $("#price-ppsf").textContent = `${money(ppsf)} / sq ft`;
  $("#price-footnote").textContent = `${confidence.toFixed(0)}% within 10%`;
  $("#price-meter").style.width = `${clamp(confidence, 4, 100)}%`;
  $("#price-benchmark").textContent = `${pct(price / Math.max(hood.median_price, 1) - 1)} vs street median`;
  animatePrice(price);

  let badge = "In line";
  let tone = "cool";
  let message = "<b>In line with</b> the median of six nearby sales";
  if (gap >= 0.06) {
    badge = "Above comps";
    tone = "warm";
    message = `<b>${Math.round(gap * 100)}% above</b> the median of six nearby sales`;
  } else if (gap <= -0.06) {
    badge = "Below comps";
    tone = "";
    message = `<b>${Math.abs(Math.round(gap * 100))}% below</b> the median of six nearby sales`;
  }
  $("#price-badge").textContent = badge;
  $("#price-badge").className = `badge ${tone}`;
  $("#pin-compare").innerHTML = `${PIN_ICON}${state.compare ? "Re-pin current" : "Pin to compare"}`;
  $("#pin-compare").setAttribute("aria-pressed", state.compare ? "true" : "false");

  $("#studio-signal").innerHTML = `
    <span class="flag ${tone}">● ${badge}</span>
    <div class="note">A ${quality}/10 quality, ${fmtInt(area)} sq ft home in
      ${esc(clean.Neighborhood)}. The model prices it at <b>${money(ppsf)} per sq ft</b>,
      against a street median of <b>${money(hood.median_price)}</b>.
      ${message}.</div>`;

  $("#studio-minis").innerHTML = [
    ["Price per sq ft", money(ppsf), `vs ${money(hood.median_ppsf)} nearby`],
    ["Neighbourhood", clean.Neighborhood, `${hood.homes} sales on record`],
    ["Living area", `${fmtInt(area)} sq ft`, `${Math.round(num(clean.BedroomAbvGr))} bed · ${houseBaths(clean)} bath`],
  ]
    .map(
      ([k, v, s]) => `<div class="mini"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`
    )
    .join("");

  const drivers = est.drivers(clean, price, 9).map((row) => ({
    ...row,
    label: bundle.labels[row.column] || row.column,
  }));

  const maxImpact = Math.max(...drivers.map((row) => Math.abs(row.impact)), 0);
  if (maxImpact < 1) {
    $("#drivers-chart").innerHTML = `<div class="empty">This is the reference home: every detail sits at a typical value, so no single driver is lifting or holding the estimate. Move one slider and the anatomy appears.</div>`;
    $("#drivers-table").innerHTML = "";
  } else {
    $("#drivers-chart").innerHTML = divergingRows(
      drivers.map((row) => ({
        label: row.label,
        value: row.impact,
        text: `${row.impact >= 0 ? "+" : "−"}${money(Math.abs(row.impact))}`,
      }))
    );

    $("#drivers-table").innerHTML = `
      <table><thead><tr><th>Driver</th><th>This home</th><th>Typical</th><th class="num">Impact</th></tr></thead>
      <tbody>${drivers
        .map(
          (row) => `<tr><td>${esc(row.label)}</td><td>${esc(formatField(row.column, clean[row.column], true))}</td>
          <td>${esc(formatField(row.column, bundle.defaults[row.column], true))}</td>
          <td class="num" style="color:${row.impact >= 0 ? "var(--good)" : "var(--bad)"}">${row.impact >= 0 ? "+" : "−"}${money(Math.abs(row.impact))}</td></tr>`
        )
        .join("")}</tbody></table>`;
  }

  $("#comps-table").innerHTML = `
    <thead><tr><th>Neighbourhood</th><th class="num">Living area</th><th class="num">Quality</th>
    <th class="num">Built</th><th class="num">Basement</th><th class="num">Garage</th>
    <th class="num">Baths</th><th class="num">Sold for</th><th>Match</th></tr></thead>
    <tbody>${comps
      .map(
        (row) => `<tr><td>${esc(row.neighborhood)}</td><td class="num">${fmtInt(row.area)}</td>
        <td class="num">${row.quality}</td><td class="num">${row.built}</td>
        <td class="num">${fmtInt(row.basement)}</td><td class="num">${fmtInt(row.garage)}</td>
        <td class="num">${row.baths}</td><td class="num">${money(row.price)}</td>
        <td><div class="match"><div class="bar-track"><i style="width:${row.match}%"></i></div><b>${row.match.toFixed(0)}%</b></div></td></tr>`
      )
      .join("")}</tbody>`;

  renderPortrait(clean);
  renderSensitivity(clean, price);
  renderLevers(clean);
  renderRadar(clean);
  renderNarrative(clean, price, hood);
  renderCompare(price, clean);
  syncQuick();
  updatePresetActive();
}

function updatePresetActive() {
  $$("[data-preset-key]").forEach((button) => {
    button.classList.toggle("active", button.dataset.presetKey === state.presetKey);
  });
}

/* ----------------------------------------------------------- diverging bars */

function divergingRows(items) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1e-9);
  return items
    .map((item) => {
      const width = Math.max(1.2, (Math.abs(item.value) / max) * 48);
      const positive = item.value >= 0;
      return `<div class="dv-row" title="${esc(item.label)}: ${esc(item.text)}">
        <span class="dv-label">${esc(item.label)}</span>
        <div class="dv-track"><i class="${positive ? "pos" : "neg"}" style="width:${width}%"></i></div>
        <span class="dv-value">${esc(item.text)}</span>
      </div>`;
    })
    .join("");
}

function barRows(items) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1e-9);
  return items
    .map(
      (item) => `<div class="bar-row" title="${esc(item.label)}">
        <span class="bar-label">${esc(item.label)}</span>
        <div class="bar-track"><i class="${item.value < 0 ? "neg" : ""}" style="width:${Math.max(2, (Math.abs(item.value) / max) * 100)}%"></i></div>
        <span class="bar-value">${esc(item.text)}</span>
      </div>`
    )
    .join("");
}

/* -------------------------------------------------------------- sensitivity */

function renderSensitivity(clean, price) {
  const field = $("#sens-feature").value;
  if (!field) return;
  const points = est.sensitivity(clean, field, 34);
  const current = num(clean[field], num(bundle.numeric_stats[field]?.median));
  $("#sens-value").innerHTML = `<span class="k">Current</span><span class="v">${esc(formatField(field, current))}</span><span class="s">${esc(bundle.labels[field] || field)}</span>`;
  $("#sens-chart").innerHTML = lineChartSVG(points, current, price, field);
  attachSensitivity(points, current, field, price);
}

function lineChartSVG(points, current, price, field) {
  const width = 860;
  const height = 300;
  const pad = { l: 64, r: 22, t: 26, b: 40 };
  if (!points.length) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y).concat([price]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const span = Math.max(xmax - xmin, 1);
  const yspan = Math.max(ymax - ymin, 1);
  const sx = (x) => pad.l + ((x - xmin) / span) * (width - pad.l - pad.r);
  const sy = (y) => height - pad.b - ((y - ymin) / yspan) * (height - pad.t - pad.b);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(xmax).toFixed(1)},${height - pad.b} L${sx(xmin).toFixed(1)},${height - pad.b} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const y = pad.t + tick * (height - pad.t - pad.b);
      const value = ymax - tick * yspan;
      return `<line class="grid-line" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${width - pad.r}" y2="${y.toFixed(1)}"/>
        <text x="${pad.l - 9}" y="${(y + 3).toFixed(1)}" text-anchor="end">${moneyShort(value)}</text>`;
    })
    .join("");

  const xTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => {
      const x = pad.l + tick * (width - pad.l - pad.r);
      const value = xmin + tick * span;
      return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle">${esc(formatField(field, value, true))}</text>`;
    })
    .join("");

  const markerX = sx(clamp(current, xmin, xmax));
  const markerY = sy(price);

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sensitivity of ${esc(bundle.labels[field] || field)}">
    <defs><linearGradient id="sensFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7d9685" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#7d9685" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}${xTicks}
    <line class="grid-line" x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}"/>
    <path class="area" d="${area}"/>
    <path class="curve" d="${line}"/>
    <line class="marker-line" x1="${markerX.toFixed(1)}" y1="${pad.t}" x2="${markerX.toFixed(1)}" y2="${height - pad.b}"/>
    <circle class="marker-dot" cx="${markerX.toFixed(1)}" cy="${markerY.toFixed(1)}" r="5.5"/>
    <text x="${(width - pad.r).toFixed(1)}" y="${pad.t - 8}" text-anchor="end" style="font-size:10px;fill:#7b867f">${esc(bundle.labels[field] || field)}</text>
    <g class="sens-hover" opacity="0">
      <line class="marker-line" x1="0" y1="${pad.t}" x2="0" y2="${height - pad.b}"/>
      <circle class="hover-dot" cx="0" cy="0" r="5"/>
      <text class="hover-label" x="0" y="0"></text>
    </g>
    <rect data-sens-overlay x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${height - pad.t - pad.b}" fill="transparent" style="cursor:crosshair"/>
  </svg>`;
}

function attachSensitivity(points, current, field, price) {
  const svg = $("#sens-chart svg");
  if (!svg) return;
  const overlay = svg.querySelector("[data-sens-overlay]");
  const hover = svg.querySelector(".sens-hover");
  if (!overlay || !hover) return;
  const width = 860;
  const height = 300;
  const pad = { l: 64, r: 22, t: 26, b: 40 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y).concat([price]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const span = Math.max(xmax - xmin, 1);
  const yspan = Math.max(ymax - ymin, 1);
  const sx = (x) => pad.l + ((x - xmin) / span) * (width - pad.l - pad.r);
  const sy = (y) => height - pad.b - ((y - ymin) / yspan) * (height - pad.t - pad.b);

  const nearest = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return null;
    const px = ((event.clientX - rect.left) / rect.width) * width;
    let best = points[0];
    let bestDistance = Infinity;
    for (const point of points) {
      const distance = Math.abs(sx(point.x) - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best || null;
  };

  const paint = (best) => {
    const x = sx(best.x);
    const y = sy(best.y);
    hover.setAttribute("opacity", "1");
    const line = hover.querySelector("line");
    const dot = hover.querySelector("circle");
    const label = hover.querySelector("text");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    const rightSide = x > width * 0.58;
    label.setAttribute("x", rightSide ? x - 10 : x + 10);
    label.setAttribute("y", Math.max(pad.t + 12, y - 12));
    label.setAttribute("text-anchor", rightSide ? "end" : "start");
    label.textContent = `${formatField(field, best.x)} · ${money(best.y)}`;
  };

  overlay.addEventListener("pointermove", (event) => {
    const best = nearest(event);
    if (best) paint(best);
  });
  overlay.addEventListener("pointerleave", () => hover.setAttribute("opacity", "0"));
  overlay.addEventListener("click", (event) => {
    const best = nearest(event);
    if (!best) return;
    const [lo, hi] = RANGES[field] || [bundle.numeric_stats[field].min, bundle.numeric_stats[field].max];
    state.house[field] = clamp(best.x, lo, hi);
    state.presetKey = null;
    syncForm();
    renderStudio();
    toast(`${bundle.labels[field] || field} set to ${formatField(field, state.house[field])}`);
  });
}

/* -------------------------------------------------------------------- radar */

function renderRadar(clean) {
  const axes = [
    { label: "Quality", value: num(clean.OverallQual, 6), typical: num(bundle.defaults.OverallQual, 6), min: 1, max: 10, show: (v) => `${Math.round(v)}/10` },
    { label: "Living area", value: num(clean.GrLivArea, 1500), typical: num(bundle.defaults.GrLivArea, 1500), min: 500, max: 3400, show: (v) => fmtInt(v) },
    { label: "Lot size", value: num(clean.LotArea, 9000), typical: num(bundle.defaults.LotArea, 9000), min: 2500, max: 24000, show: (v) => `${(v / 1000).toFixed(1)}k` },
    { label: "Baths", value: houseBaths(clean), typical: houseBaths(bundle.defaults), min: 0, max: 4, show: (v) => v.toFixed(1).replace(".0", "") },
    { label: "Garage", value: num(clean.GarageCars, 2), typical: num(bundle.defaults.GarageCars, 2), min: 0, max: 3, show: (v) => `${Math.round(v)}` },
    { label: "Condition", value: num(clean.OverallCond, 5), typical: num(bundle.defaults.OverallCond, 5), min: 1, max: 10, show: (v) => `${Math.round(v)}/10` },
  ];
  const cx = 210;
  const cy = 168;
  const radius = 112;
  const norm = (axis, value) => clamp((value - axis.min) / Math.max(axis.max - axis.min, 1), 0.06, 1);
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / axes.length;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
  };
  const polygon = (values) => values.map((ratio, index) => point(index, ratio).map((n) => n.toFixed(1)).join(",")).join(" ");
  const home = axes.map((axis) => norm(axis, axis.value));
  const typical = axes.map((axis) => norm(axis, axis.typical));

  const rings = [0.25, 0.5, 0.75, 1]
    .map((ring) => `<polygon class="ring" points="${polygon(axes.map(() => ring))}"/>`)
    .join("");
  const spokes = axes
    .map((axis, index) => {
      const [x, y] = point(index, 1);
      return `<line class="axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    })
    .join("");
  const labels = axes
    .map((axis, index) => {
      const [x, y] = point(index, 1.19);
      const anchor = Math.cos(-Math.PI / 2 + (index * Math.PI * 2) / axes.length) > 0.3 ? "start" : Math.cos(-Math.PI / 2 + (index * Math.PI * 2) / axes.length) < -0.3 ? "end" : "middle";
      return `<text class="axis-label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${esc(axis.label)}</text>
        <text x="${x.toFixed(1)}" y="${(y + 14).toFixed(1)}" text-anchor="${anchor}" style="font-family:var(--serif);font-size:11px;fill:#4f6b5b">${esc(axis.show(axis.value))}</text>`;
    })
    .join("");
  const dots = home
    .map((ratio, index) => {
      const [x, y] = point(index, ratio);
      return `<circle class="home-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`;
    })
    .join("");

  $("#radar").innerHTML = `<svg viewBox="0 0 420 344" role="img" aria-label="Home character compared with a typical Ames home">
    ${rings}${spokes}
    <polygon class="typical-shape" points="${polygon(typical)}"/>
    <polygon class="home-shape" points="${polygon(home)}"/>
    ${dots}${labels}
  </svg>`;
}

/* ---------------------------------------------------------------- narrative */

function renderNarrative(clean, price, hood) {
  const area = num(clean.GrLivArea, 1500);
  const quality = Math.round(num(clean.OverallQual, 6));
  const ppsf = price / Math.max(area, 1);
  const age = Math.max(num(clean.YrSold, 2008) - num(clean.YearBuilt, 1975), 0);
  const priceRel = price / Math.max(hood.median_price, 1) - 1;
  const areaRel = area / Math.max(hood.median_area, 1) - 1;
  const ppsfRel = ppsf / Math.max(hood.median_ppsf, 1) - 1;

  let title = "A value-minded corner of Ames";
  if (hood.median_price >= 250000) title = "A quiet, high-market pocket";
  else if (hood.median_price >= 190000) title = "An established, mid-market street";
  else if (hood.median_price >= 140000) title = "A steady, value-minded street";

  const drivers = est.drivers(clean, price, 8);
  const lift = drivers.filter((row) => row.impact > 0).sort((a, b) => b.impact - a.impact)[0];
  const drag = drivers.filter((row) => row.impact < 0).sort((a, b) => a.impact - b.impact)[0];
  const liftText = lift ? `The strongest lift comes from <b>${esc(bundle.labels[lift.column] || lift.column)}</b> (${money(lift.impact)}).` : "";
  const dragText = drag ? ` <b>${esc(bundle.labels[drag.column] || drag.column)}</b> is the detail holding it back (${money(Math.abs(drag.impact))}).` : "";

  const direction = Math.abs(priceRel) < 0.02 ? "in line with" : `${plainPct(priceRel)} ${priceRel > 0 ? "above" : "below"}`;
  $("#narrative-title").textContent = title;
  $("#narrative-body").innerHTML = `This ${fmtInt(area)} sq ft, ${Math.round(num(clean.BedroomAbvGr))}-bedroom home in
    <b>${esc(clean.Neighborhood)}</b> is <b>${direction}</b> its street's median of ${money(hood.median_price)}.
    At ${quality}/10 quality and ${age} years old, it reads as a ${quality >= 8 ? "careful, well-finished" : quality >= 6 ? "solid, liveable" : "modest, practical"} home.
    ${liftText}${dragText}`;

  const rows = [
    ["Price", priceRel, `${pct(priceRel)}`],
    ["$ / sq ft", ppsfRel, `${pct(ppsfRel)}`],
    ["Living area", areaRel, `${pct(areaRel)}`],
  ];
  $("#hood-compare").innerHTML = rows
    .map(([label, rel, text]) => {
      const width = Math.max(1.5, Math.min(48, Math.abs(rel) * 100 * 1.15));
      return `<div class="hc-row"><span class="k">${esc(label)}</span>
        <div class="hc-track"><i class="${rel >= 0 ? "pos" : "neg"}" style="width:${width}%"></i></div>
        <span class="v">${esc(text)}</span></div>`;
    })
    .join("");
  $("#hood-switch").value = String(clean.Neighborhood);
}

/* ------------------------------------------------------------------- levers */

function renderLevers(clean) {
  state.levers = est.levers(clean);
  $("#levers").innerHTML = state.levers
    .map(
      (lever, index) => `<button class="lever" data-lever="${index}" aria-label="Apply: ${esc(lever.label)}">
        <b>${esc(lever.label)}</b>
        <span class="delta ${lever.delta >= 0 ? "pos" : "neg"}">${lever.delta >= 0 ? "+" : "−"}${money(Math.abs(lever.delta))}</span>
        <small>${lever.delta >= 0 ? "value added" : "value removed"} vs this home</small>
      </button>`
    )
    .join("");
}

/* ----------------------------------------------------------------- scenarios */

function renderScenarios() {
  $("#scenario-count").textContent = `${state.scenarios.length} saved`;
  $("#clear-scenarios").disabled = !state.scenarios.length;
  if (!state.scenarios.length) {
    $("#scenarios").innerHTML = `<div class="empty">No saved readings yet. Shape a home, name it, and keep it here.</div>`;
    return;
  }
  $("#scenarios").innerHTML = state.scenarios
    .map(
      (scenario, index) => `<div class="scenario">
        <div><div class="name">${esc(scenario.name)}</div><div class="meta">${esc(scenario.detail)}</div></div>
        <div class="price">${money(scenario.price)}</div>
        <div class="actions">
          <button class="icon-btn" data-load="${index}" title="Open this reading">Open</button>
          <button class="icon-btn" data-delete="${index}" title="Remove">✕</button>
        </div>
      </div>`
    )
    .join("");
}

function saveScenario() {
  const { clean, price } = estimate();
  const input = $("#scenario-name");
  const name = input.value.trim() || `${clean.Neighborhood} · ${fmtInt(clean.GrLivArea)} sq ft`;
  state.scenarios.push({
    name,
    price,
    detail: `${clean.Neighborhood} · Q${Math.round(num(clean.OverallQual))} · ${fmtInt(clean.GrLivArea)} sq ft`,
    house: structuredClone(clean),
  });
  storeJSON("novaestate.atelier.scenarios", state.scenarios);
  input.value = "";
  renderScenarios();
  toast(`Saved “${name}”`);
}

function loadScenario(index) {
  const scenario = state.scenarios[index];
  if (!scenario) return;
  state.house = structuredClone(scenario.house);
  state.presetKey = null;
  syncForm();
  syncQuick();
  renderStudio();
  showView("studio");
  setTimeout(() => $("#view-studio .studio-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  toast(`Opened “${scenario.name}”`);
}

/* ------------------------------------------------------------------- compare */

function compareMetrics(house, price) {
  const area = Math.max(num(house.GrLivArea, 1), 1);
  return {
    price,
    ppsf: price / area,
    area,
    quality: Math.round(num(house.OverallQual, 6)),
    beds: Math.round(num(house.BedroomAbvGr, 3)),
    baths: houseBaths(house),
  };
}

function renderCompare(price, clean) {
  const tray = $("#compare-tray");
  if (!state.compare?.house) {
    tray.classList.add("hidden");
    return;
  }
  tray.classList.remove("hidden");
  const a = compareMetrics(state.compare.house, state.compare.price);
  const b = compareMetrics(clean, price);
  const delta = a.price ? b.price / a.price - 1 : 0;
  $("#compare-name").textContent = state.compare.name || "home";
  $("#compare-a").textContent = money(a.price);
  $("#compare-b").textContent = money(b.price);
  $("#compare-delta").textContent = pct(delta);
  $("#compare-delta").className = `compare-delta ${delta < 0 ? "neg" : ""}`;

  const diff = (value, digits = 0, asPercent = true) => {
    if (!value) return "—";
    if (asPercent) return pct(value, digits);
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
  };
  const rows = [
    ["Estimated value", money(a.price), money(b.price), diff(delta, 1)],
    ["$ / sq ft", money(a.ppsf), money(b.ppsf), diff(a.ppsf ? b.ppsf / a.ppsf - 1 : 0, 1)],
    ["Living area", `${fmtInt(a.area)} sq ft`, `${fmtInt(b.area)} sq ft`, diff(a.area ? b.area / a.area - 1 : 0, 1)],
    ["Quality", `${a.quality}/10`, `${b.quality}/10`, diff(b.quality - a.quality, 0, false)],
    ["Bedrooms", `${a.beds}`, `${b.beds}`, diff(b.beds - a.beds, 0, false)],
    ["Bathrooms", `${a.baths}`, `${b.baths}`, diff(b.baths - a.baths, 1, false)],
  ];
  $("#compare-body").innerHTML = `<table><thead><tr><th>Reading</th><th class="num">Pinned</th><th class="num">Now</th><th class="num">Change</th></tr></thead>
    <tbody>${rows
      .map(
        ([label, av, bv, change]) => `<tr><td>${esc(label)}</td><td class="num">${esc(av)}</td><td class="num">${esc(bv)}</td><td class="num ${String(change).startsWith("+") ? "diff-up" : String(change).startsWith("−") ? "diff-down" : ""}">${esc(change)}</td></tr>`
      )
      .join("")}</tbody></table>`;
}

function pinCurrent() {
  const { clean, price } = estimate();
  state.compare = {
    name: `${clean.Neighborhood} · ${fmtInt(clean.GrLivArea)} sq ft`,
    price,
    house: structuredClone(clean),
    saved: Date.now(),
  };
  storeJSON("novaestate.atelier.compare", state.compare);
  renderCompare(price, clean);
  $("#compare-tray").classList.remove("hidden");
  $("#compare-tray").classList.remove("open");
  toast("Pinned as A — keep shaping to see what changes");
}

function unpinCompare() {
  state.compare = null;
  storeJSON("novaestate.atelier.compare", null);
  $("#compare-tray").classList.add("hidden");
  $("#compare-tray").classList.remove("open");
  toast("Comparison cleared");
}

/* ------------------------------------------------------------------- market */

function qualityColor(quality, alpha = 0.55) {
  const t = (clamp(num(quality, 5), 1, 10) - 1) / 9;
  let r;
  let g;
  let b;
  if (t < 0.5) {
    const u = t * 2;
    r = lerp(147, 125, u);
    g = lerp(169, 150, u);
    b = lerp(179, 133, u);
  } else {
    const u = (t - 0.5) * 2;
    r = lerp(125, 179, u);
    g = lerp(150, 139, u);
    b = lerp(133, 109, u);
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

function setupCanvas(canvas, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(canvas.clientWidth || canvas.parentElement?.clientWidth || 0, 320);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawAxes(ctx, width, height, pad, yLabel, xLabel, yTicks, xTicks, yFormat, xFormat) {
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = "#8b968f";
  ctx.strokeStyle = "rgba(40,51,46,0.09)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (i / 4) * (height - pad.t - pad.b);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(yFormat(yTicks[4 - i]), pad.l - 8, y + 3);
  }
  for (let i = 0; i <= 4; i += 1) {
    const x = pad.l + (i / 4) * (width - pad.l - pad.r);
    ctx.textAlign = "center";
    ctx.fillText(xFormat(xTicks[i]), x, height - pad.b + 15);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#7b867f";
  ctx.fillText(yLabel, pad.l, 13);
  ctx.textAlign = "right";
  ctx.fillText(xLabel, width - pad.r, height - 5);
  ctx.textAlign = "left";
}

function buildMarketSelect() {
  const select = $("#market-hood");
  if (!select || select.options.length > 1) return;
  const hoods = [...new Set(bundle.market.map((row) => row.n))].sort();
  select.insertAdjacentHTML(
    "beforeend",
    hoods.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")
  );
}

function renderMarket() {
  const prices = bundle.market.map((row) => row.p).sort((a, b) => a - b);
  const med = prices[Math.floor(prices.length / 2)];
  const ppsf = bundle.market.map((row) => row.p / Math.max(row.a, 1)).sort((a, b) => a - b);
  $("#market-stats").innerHTML = [
    ["Sales on record", bundle.market.length.toLocaleString("en-US"), "Ames · 2006–2010"],
    ["Median sale", money(med), "all neighbourhoods"],
    ["Median $/sq ft", money(ppsf[Math.floor(ppsf.length / 2)]), "across the city"],
    ["Neighbourhoods", bundle.neighborhoods.length, "from affordable to estate"],
    ["Held-out R²", Number(bundle.metrics.r2).toFixed(3), "validation homes"],
  ]
    .map(([k, v, s]) => `<div class="mini"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`)
    .join("");

  renderHoodBars();
  renderHoodDetail($("#market-hood").value);
  renderMarketScatter();
  renderDistribution();
}

function renderHoodBars() {
  const active = $("#market-hood").value;
  const max = Math.max(...bundle.neighborhoods.map((row) => row.median_price));
  $("#hood-bars").innerHTML = bundle.neighborhoods
    .map(
      (row) => `<button class="hood-row ${row.Neighborhood === active ? "active" : ""}" data-hood="${esc(row.Neighborhood)}" title="Explore ${esc(row.Neighborhood)}">
        <span class="n">${esc(row.Neighborhood)}</span>
        <div class="bar-track"><i style="width:${(row.median_price / max) * 100}%"></i></div>
        <span class="v">${moneyShort(row.median_price)}</span>
      </button>`
    )
    .join("");
}

function renderHoodDetail(name) {
  const rows = name ? bundle.market.filter((row) => row.n === name) : bundle.market;
  const prices = rows.map((row) => row.p).sort((a, b) => a - b);
  const ppsf = rows.map((row) => row.p / Math.max(row.a, 1)).sort((a, b) => a - b);
  const areas = rows.map((row) => row.a).sort((a, b) => a - b);
  const qualities = rows.map((row) => row.q).sort((a, b) => a - b);
  const years = rows.map((row) => row.y).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)] || 0;
  const medianPpsf = ppsf[Math.floor(ppsf.length / 2)] || 0;
  const medianArea = areas[Math.floor(areas.length / 2)] || 0;
  const medianQuality = qualities[Math.floor(qualities.length / 2)] || 0;
  const medianYear = years[Math.floor(years.length / 2)] || 0;
  const label = name || "All of Ames";
  $("#hood-detail-name").textContent = label;
  $("#hood-use").disabled = !name;

  const { clean, price } = estimate();
  const area = num(clean.GrLivArea, 1);
  const ppsfNow = price / Math.max(area, 1);
  const priceRel = median ? price / median - 1 : 0;
  const areaRel = medianArea ? area / medianArea - 1 : 0;
  const note = name
    ? `Your reading is <b>${plainPct(priceRel)} ${priceRel >= 0 ? "above" : "below"}</b> this street's median.
       Living area is ${plainPct(areaRel)} ${areaRel >= 0 ? "larger" : "smaller"} than typical here,
       and the home is ${Math.round(num(clean.YrSold, 2008) - medianYear)} years ${num(clean.YrSold, 2008) >= medianYear ? "newer" : "older"} than the street median.`
    : `Choose a neighbourhood to see how this home sits against it. Across Ames, the median sale is ${money(median)} at ${money(medianPpsf)} per sq ft.`;

  $("#hood-detail-body").innerHTML = `
    <div class="hd-stat"><div class="k">Sales</div><div class="v">${rows.length.toLocaleString("en-US")}</div><div class="s">recorded 2006–2010</div></div>
    <div class="hd-stat"><div class="k">Median sale</div><div class="v">${moneyShort(median)}</div><div class="s">${money(median)}</div></div>
    <div class="hd-stat"><div class="k">Median $/sq ft</div><div class="v">${money(medianPpsf)}</div><div class="s">${name ? `you: ${money(ppsfNow)}` : "whole city"}</div></div>
    <div class="hd-stat"><div class="k">Median area</div><div class="v">${fmtInt(medianArea)}</div><div class="s">sq ft · quality ${medianQuality}/10</div></div>
    <div class="hd-stat"><div class="k">Median year</div><div class="v">${medianYear}</div><div class="s">${name ? `you: ${Math.round(num(clean.YearBuilt))}` : "across all sales"}</div></div>
    <div class="hd-stat"><div class="k">Your estimate</div><div class="v">${moneyShort(price)}</div><div class="s">${name ? pct(priceRel) + " vs street" : "current reading"}</div></div>
    <div class="hd-note">${note}</div>`;
}

function renderMarketScatter(hoverRow = null) {
  const canvas = $("#market-scatter");
  if (!canvas || !canvas.clientWidth) return;
  const { ctx, width, height } = setupCanvas(canvas, 380);
  const pad = { l: 58, r: 16, t: 28, b: 44 };
  const minQuality = num($("#market-quality").value, 1);
  const hood = $("#market-hood").value;
  const rows = bundle.market.filter(
    (row) => row.q >= minQuality && row.a >= 300 && row.a <= 6500 && (!hood || row.n === hood)
  );
  const xs = rows.map((row) => row.a);
  const ys = rows.map((row) => row.p);
  const xmin = 300;
  const xmax = Math.max(...xs, 6000);
  const ymin = 40000;
  const ymax = Math.max(...ys, 800000);
  const sx = (x) => pad.l + ((x - xmin) / Math.max(xmax - xmin, 1)) * (width - pad.l - pad.r);
  const sy = (y) => height - pad.b - ((y - ymin) / Math.max(ymax - ymin, 1)) * (height - pad.t - pad.b);

  ctx.clearRect(0, 0, width, height);
  drawAxes(
    ctx, width, height, pad, "Sale price", "Living area",
    [ymin, ymin + (ymax - ymin) / 4, ymin + (ymax - ymin) / 2, ymin + (3 * (ymax - ymin)) / 4, ymax],
    [xmin, xmin + (xmax - xmin) / 4, xmin + (xmax - xmin) / 2, xmin + (3 * (xmax - xmin)) / 4, xmax],
    moneyShort, (v) => fmtInt(v)
  );

  for (const row of rows) {
    ctx.fillStyle = qualityColor(row.q);
    ctx.beginPath();
    ctx.arc(sx(row.a), sy(row.p), row.q >= 8 ? 3.2 : 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const { clean, price } = estimate();
  if (!hood || hood === clean.Neighborhood) {
    const x = sx(clamp(num(clean.GrLivArea), xmin, xmax));
    const y = sy(clamp(price, ymin, ymax));
    ctx.strokeStyle = "#b38b6d";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#b38b6d";
    ctx.font = "500 10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("this home", x + 12, y + 3);
  }

  if (hoverRow) {
    ctx.strokeStyle = "rgba(34,46,41,0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx(hoverRow.a), sy(hoverRow.p), 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  scatterGeom = { rows, sx, sy, width, height, canvas };
  $("#market-count").textContent = `${rows.length.toLocaleString("en-US")} sales shown${hood ? ` in ${hood}` : ""}`;
}

function attachScatterHover() {
  const canvas = $("#market-scatter");
  const tip = $("#chart-tip");
  const wrap = tip?.parentElement;
  if (!canvas || !tip || !wrap) return;

  const hide = () => {
    tip.classList.remove("show");
    if (scatterHover) {
      scatterHover = null;
      renderMarketScatter();
    }
  };

  canvas.addEventListener("pointermove", (event) => {
    if (!scatterGeom) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * scatterGeom.width;
    const my = ((event.clientY - rect.top) / rect.height) * scatterGeom.height;
    let best = null;
    let bestDistance = 13;
    for (const row of scatterGeom.rows) {
      const dx = scatterGeom.sx(row.a) - mx;
      const dy = scatterGeom.sy(row.p) - my;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row;
      }
    }
    if (!best) {
      hide();
      return;
    }
    if (best !== scatterHover) {
      scatterHover = best;
      renderMarketScatter(best);
    }
    const wrapRect = wrap.getBoundingClientRect();
    tip.style.left = `${event.clientX - wrapRect.left}px`;
    tip.style.top = `${event.clientY - wrapRect.top}px`;
    tip.innerHTML = `<b>${esc(best.n)}</b> · ${money(best.p)}<small>${fmtInt(best.a)} sq ft · quality ${best.q}/10 · built ${best.y}</small>`;
    tip.classList.add("show");
  });

  canvas.addEventListener("pointerleave", hide);
  canvas.addEventListener("click", () => {
    if (!scatterHover) return;
    const hood = scatterHover.n;
    $("#market-hood").value = hood;
    renderHoodBars();
    renderHoodDetail(hood);
    renderMarketScatter();
    toast(`Filtered to ${hood} — click the row again to clear`);
    scatterHover = null;
    tip.classList.remove("show");
  });
}

function renderDistribution() {
  const canvas = $("#price-dist");
  if (!canvas || !canvas.clientWidth) return;
  const { ctx, width, height } = setupCanvas(canvas, 260);
  const pad = { l: 40, r: 14, t: 18, b: 34 };
  const maxPrice = 825000;
  const step = 25000;
  const bins = new Array(Math.ceil(maxPrice / step)).fill(0);
  const prices = bundle.market.map((row) => row.p);
  for (const price of prices) {
    const index = Math.min(bins.length - 1, Math.floor(price / step));
    bins[index] += 1;
  }
  const maxCount = Math.max(...bins, 1);
  const { price } = estimate();
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const barW = plotW / bins.length;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = "#8b968f";
  ctx.strokeStyle = "rgba(40,51,46,0.09)";
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.t + (i / 3) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(Math.round(maxCount * (1 - i / 3)), pad.l - 6, y + 3);
  }
  bins.forEach((count, index) => {
    const h = (count / maxCount) * plotH;
    const x = pad.l + index * barW;
    ctx.fillStyle = index * step >= price - step && index * step < price ? "rgba(179,139,109,0.55)" : "rgba(125,150,133,0.42)";
    ctx.fillRect(x + 1, pad.t + plotH - h, Math.max(barW - 2, 1), h);
  });

  const median = prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const line = (value, color, dashed) => {
    const x = pad.l + (clamp(value, 0, maxPrice) / maxPrice) * plotW;
    ctx.save();
    ctx.setLineDash(dashed ? [4, 4] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.restore();
  };
  line(median, "rgba(40,51,46,0.35)", true);
  line(price, "#a8776a", false);

  ctx.fillStyle = "#7b867f";
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i += 1) {
    const value = (i / 4) * maxPrice;
    ctx.fillText(moneyShort(value), pad.l + (i / 4) * plotW, height - 12);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "#a8776a";
  ctx.fillText("you", width - pad.r, pad.t - 4);

  const below = prices.filter((value) => value <= price).length;
  const share = (below / prices.length) * 100;
  $("#dist-caption").innerHTML = `The clay line is your estimate. It sits above <b>${share.toFixed(0)}%</b> of the ${prices.length.toLocaleString("en-US")} recorded sales; the dashed line is the city median of ${money(median)}.`;
}

/* -------------------------------------------------------------------- model */

function prettyCoef(name) {
  const index = name.lastIndexOf("_");
  if (index > 0) {
    const base = name.slice(0, index);
    const rest = name.slice(index + 1);
    return `${bundle.labels[base] || base} · ${rest}`;
  }
  return bundle.labels[name] || name;
}

function renderModel() {
  const m = bundle.metrics;
  $("#model-metrics").innerHTML = [
    ["Validation R²", Number(m.r2).toFixed(3), "share of price variation explained"],
    ["RMSE", money(m.rmse), "root mean squared error"],
    ["MAE", money(m.mae), "typical absolute miss"],
    ["Within 10%", `${Number(m.within_10).toFixed(1)}%`, "of held-out homes"],
    ["Validation homes", Number(m.n_val).toLocaleString("en-US"), "never seen in training"],
    ["Training homes", Number(m.n_train).toLocaleString("en-US"), "used to fit the Ridge model"],
  ]
    .map(([k, v, s]) => `<div class="mini"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`)
    .join("");

  drawParity();

  const coefs = bundle.top_coefficients.slice(0, 14).map((row) => ({
    label: prettyCoef(row.name),
    value: row.value,
    text: `${row.value >= 0 ? "+" : "−"}${Math.abs(row.value).toFixed(2)}`,
  }));
  $("#coef-bars").innerHTML = divergingRows(coefs);

  const clean = est.sanitize(state.house);
  const contributions = est.contributions(clean);
  const groups = {};
  for (const [field, value] of Object.entries(contributions)) {
    // The encoder imputes non-finite transformed values, so they contribute
    // nothing to the estimate. Mirror that here instead of summing Infinity.
    if (!Number.isFinite(value)) continue;
    const group = bundle.field_groups[field] || "Other";
    groups[group] = (groups[group] || 0) + value;
  }
  const sum = Object.values(groups).reduce((acc, value) => acc + value, 0);
  const total = Number.isFinite(sum) && sum > 0 ? sum : 1;
  const groupRows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  $("#group-bars").innerHTML = barRows(
    groupRows.map(([group, value]) => ({
      label: group,
      value,
      text: `${((value / total) * 100).toFixed(0)}%`,
    }))
  );

  const steps = [
    ["1 · Coherence", "Living area, basement, garage and extras are reconciled before pricing."],
    ["2 · Engineering", "Age, total square footage, bathrooms, porches and presence flags are derived."],
    ["3 · Skew control", "Power and quantile transforms tame the long tails of area and value."],
    ["4 · Ridge", "245 encoded signals are combined, then mapped back from the transformed target."],
  ];
  $("#pipeline").innerHTML = steps
    .map(([k, v]) => `<div class="mini"><div class="k">${esc(k)}</div><div class="s">${esc(v)}</div></div>`)
    .join("");
}

function drawParity() {
  const canvas = $("#parity");
  if (!canvas || !canvas.clientWidth) return;
  const { ctx, width, height } = setupCanvas(canvas, 380);
  const pad = { l: 58, r: 16, t: 28, b: 44 };
  const rows = bundle.validation;
  const lo = Math.min(...rows.map((row) => Math.min(row.a, row.p)));
  const hi = Math.max(...rows.map((row) => Math.max(row.a, row.p)));
  const sx = (v) => pad.l + ((v - lo) / Math.max(hi - lo, 1)) * (width - pad.l - pad.r);
  const sy = (v) => height - pad.b - ((v - lo) / Math.max(hi - lo, 1)) * (height - pad.t - pad.b);

  ctx.clearRect(0, 0, width, height);
  drawAxes(
    ctx, width, height, pad, "Predicted value", "Actual sale price",
    [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + (3 * (hi - lo)) / 4, hi],
    [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + (3 * (hi - lo)) / 4, hi],
    moneyShort, moneyShort
  );

  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "rgba(179,139,109,0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx(lo), sy(lo));
  ctx.lineTo(sx(hi), sy(hi));
  ctx.stroke();
  ctx.setLineDash([]);

  for (const row of rows) {
    ctx.fillStyle = "rgba(79,107,91,0.4)";
    ctx.beginPath();
    ctx.arc(sx(row.a), sy(row.p), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const residuals = rows.map((row) => row.a - row.p).sort((a, b) => a - b);
  $("#parity-caption").textContent = `Median residual ${money(residuals[Math.floor(residuals.length / 2)])} across ${rows.length} held-out homes.`;
}

/* ---------------------------------------------------------- command palette */

function buildPalette() {
  if (paletteItems.length) return;
  const add = (group, label, hint, icon, action) => paletteItems.push({ group, label, hint, icon, action });

  add("Go", "Studio", "shape a home", "→", () => { closePalette(); showView("studio"); });
  add("Go", "Market", "explore every sale", "→", () => { closePalette(); showView("market"); });
  add("Go", "Model", "how the estimate is made", "→", () => { closePalette(); showView("model"); });

  add("Actions", "Pin this home for comparison", "P", "◆", () => { closePalette(); pinCurrent(); });
  add("Actions", "Reset to a typical Ames home", "R", "↺", () => { closePalette(); resetHome(); });
  add("Actions", "Surprise me with a recorded sale", "", "✧", () => { closePalette(); surprise(); });
  add("Actions", "Save the current reading", "S", "✚", () => { closePalette(); saveScenario(); });
  add("Actions", "Clear the saved shelf", "", "✕", () => { closePalette(); clearScenarios(); });
  add("Actions", "Expand every detail group", "", "▾", () => { closePalette(); expandAllGroups(); });

  for (const preset of bundle.presets) {
    add("Presets", preset.name, preset.tagline, "◆", () => { closePalette(); applyPreset(preset.key); });
  }

  bundle.input_columns
    .filter((field) => !HIDDEN.has(field))
    .map((field) => ({ field, label: bundle.labels[field] || field, group: bundle.field_groups[field] || "Details" }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(({ field, label, group }) => {
      add("Details", label, group, "◇", () => { closePalette(); jumpToField(field); });
    });
}

function openPalette() {
  buildPalette();
  const overlay = $("#palette");
  overlay.classList.remove("hidden");
  document.body.classList.add("locked");
  const input = $("#palette-input");
  input.value = "";
  paletteActive = 0;
  renderPalette("");
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  $("#palette").classList.add("hidden");
  document.body.classList.remove("locked");
}

function renderPalette(query) {
  const q = query.trim().toLowerCase();
  let scored = paletteItems.map((item, index) => ({ item, index, score: 0 }));
  if (q) {
    scored = scored
      .map((row) => {
        const label = row.item.label.toLowerCase();
        const hint = String(row.item.hint || "").toLowerCase();
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : hint.includes(q) ? 2 : 99;
        return { ...row, score };
      })
      .filter((row) => row.score < 99)
      .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  }
  paletteFiltered = scored.slice(0, 60);
  paletteActive = clamp(paletteActive, 0, Math.max(paletteFiltered.length - 1, 0));

  if (!paletteFiltered.length) {
    $("#palette-results").innerHTML = `<div class="palette-empty">No detail, view or action matches “${esc(query)}”.</div>`;
    return;
  }

  let html = "";
  let group = "";
  paletteFiltered.forEach((row, index) => {
    if (row.item.group !== group) {
      group = row.item.group;
      html += `<div class="palette-group">${esc(group)}</div>`;
    }
    html += `<button class="palette-item ${index === paletteActive ? "active" : ""}" data-palette-index="${index}">
      <span class="pi-icon">${esc(row.item.icon)}</span>
      <span>${esc(row.item.label)}</span>
      <span class="pi-hint">${esc(row.item.hint || "")}</span>
    </button>`;
  });
  $("#palette-results").innerHTML = html;
}

function movePalette(direction) {
  if (!paletteFiltered.length) return;
  paletteActive = (paletteActive + direction + paletteFiltered.length) % paletteFiltered.length;
  renderPalette($("#palette-input").value);
  const active = $(".palette-item.active");
  active?.scrollIntoView({ block: "nearest" });
}

function runPalette(index) {
  const row = paletteFiltered[index];
  if (!row) return;
  row.item.action();
}

/* ---------------------------------------------------------- navigation/jump */

function setFormTab(form) {
  $$("#form-switch button").forEach((button) => button.classList.toggle("active", button.dataset.form === form));
  $("#form-essentials").classList.toggle("hidden", form !== "essentials");
  $("#form-advanced").classList.toggle("hidden", form !== "advanced");
}

function showView(view, opts = {}) {
  if (!["studio", "market", "model"].includes(view)) return;
  state.view = view;
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "market") requestAnimationFrame(() => renderMarket());
  if (view === "model") requestAnimationFrame(() => renderModel());
  if (!opts.silent) window.scrollTo({ top: 0, behavior: "smooth" });
  if (!opts.noHash) {
    try {
      history.replaceState(null, "", `#${view}`);
    } catch {
      /* ignore */
    }
  }
}

function jumpToField(field) {
  if (HIDDEN.has(field)) field = "GrLivArea";
  showView("studio", { silent: true });
  $("#field-search").value = "";
  applyFieldFilter();
  const essential = ESSENTIALS.includes(field);
  setFormTab(essential ? "essentials" : "advanced");
  if (!essential) {
    const groups = $$("#form-advanced .group");
    for (const group of groups) {
      if ([...group.querySelectorAll("[data-field]")].some((el) => el.dataset.field === field)) {
        group.open = true;
        break;
      }
    }
  }
  const control = $$("#view-studio [data-field]").find((el) => el.dataset.field === field);
  if (!control) {
    toast("That detail is derived automatically by the model");
    return;
  }
  const wrapper = control.closest(".field");
  wrapper?.classList.add("flash");
  setTimeout(() => {
    control.scrollIntoView({ behavior: "smooth", block: "center" });
    control.focus({ preventScroll: true });
  }, 100);
  setTimeout(() => wrapper?.classList.remove("flash"), 2200);
  toast(`${bundle.labels[field] || field} — ready to tune`);
}

function applyFieldFilter() {
  const query = $("#field-search").value.trim().toLowerCase();
  const fields = $$("#view-studio .field");
  fields.forEach((field) => {
    const visible = !query || (field.dataset.fieldLabel || "").includes(query);
    field.classList.toggle("hidden", !visible);
  });
  $$("#form-advanced .group").forEach((group) => {
    const any = [...group.querySelectorAll(".field")].some((field) => !field.classList.contains("hidden"));
    group.classList.toggle("filtered-out", Boolean(query) && !any);
    if (query && any) group.open = true;
  });
  if (query) setFormTab("advanced");
  const matches = fields.filter((field) => !field.classList.contains("hidden")).length;
  $("#control-foot-note").textContent = query
    ? `${matches} detail${matches === 1 ? "" : "s"} match “${$("#field-search").value.trim()}”`
    : "79 details · the essentials are enough to start";
}

function clearScenarios() {
  if (!state.scenarios.length) return;
  state.scenarios = [];
  storeJSON("novaestate.atelier.scenarios", state.scenarios);
  renderScenarios();
  toast("Shelf cleared");
}

function expandAllGroups() {
  const groups = $$("#form-advanced .group");
  if (!groups.length) return;
  const allOpen = groups.every((group) => group.open);
  groups.forEach((group) => { group.open = !allOpen; });
  $("#expand-all").textContent = allOpen ? "Expand all groups" : "Collapse all groups";
}

/* ------------------------------------------------------------------ portrait */

function setupPortrait() {
  const stage = $("#portrait");
  if (!stage) return;
  stage.addEventListener("pointermove", (event) => {
    const part = event.target.closest(".house-part");
    const tip = $("#portrait-tip");
    if (!part || !tip) {
      tip?.classList.remove("show");
      return;
    }
    const rect = stage.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 70, rect.width - 70);
    const y = clamp(event.clientY - rect.top, 26, rect.height - 8);
    tip.textContent = part.dataset.tip || "";
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("show");
  });
  stage.addEventListener("pointerleave", () => $("#portrait-tip")?.classList.remove("show"));
  stage.addEventListener("click", (event) => {
    const part = event.target.closest(".house-part");
    if (part?.dataset.jump) jumpToField(part.dataset.jump);
  });
  stage.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const part = document.activeElement?.closest?.(".house-part");
    if (part?.dataset.jump) {
      event.preventDefault();
      jumpToField(part.dataset.jump);
    }
  });
}

/* -------------------------------------------------------------------- wiring */

function bindEvents() {
  $$("[data-view]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      showView(el.dataset.view);
    });
  });

  $("#open-palette").addEventListener("click", openPalette);
  $("#reset-home").addEventListener("click", resetHome);
  $("#expand-all").addEventListener("click", expandAllGroups);
  $("#pin-compare").addEventListener("click", pinCurrent);

  $("#form-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-form]");
    if (button) setFormTab(button.dataset.form);
  });

  $("#explain-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-panel]");
    if (!button) return;
    state.activeExplain = button.dataset.panel;
    $$("#explain-tabs button").forEach((b) => b.classList.toggle("active", b === button));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.activeExplain}`));
    if (state.activeExplain === "sensitivity") {
      const { clean, price } = estimate();
      renderSensitivity(clean, price);
    }
  });

  $("#presets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) applyPreset(button.dataset.preset);
  });

  $("#field-search").addEventListener("input", applyFieldFilter);

  document.addEventListener("input", (event) => {
    const quick = event.target.closest("[data-quick]");
    if (quick) {
      state.house[quick.dataset.quick] = Number(quick.value);
      state.presetKey = null;
      syncForm();
      schedule();
      return;
    }
    const field = event.target.closest("[data-field]");
    if (field) handleControl(field);
  });

  document.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) handleControl(field);
  });

  $("#sens-feature").addEventListener("change", () => {
    const { clean, price } = estimate();
    renderSensitivity(clean, price);
  });

  $("#sens-reset").addEventListener("click", () => {
    const field = $("#sens-feature").value;
    if (!field) return;
    state.house[field] = bundle.defaults[field];
    state.presetKey = null;
    syncForm();
    renderStudio();
    toast(`${bundle.labels[field] || field} returned to typical`);
  });

  $("#levers").addEventListener("click", (event) => {
    const button = event.target.closest("[data-lever]");
    if (!button) return;
    const lever = state.levers[num(button.dataset.lever)];
    if (!lever) return;
    state.house = structuredClone(lever.house);
    state.presetKey = null;
    syncForm();
    syncQuick();
    renderStudio();
    toast(`${lever.label} applied — ${lever.delta >= 0 ? "+" : "−"}${money(Math.abs(lever.delta))}`);
  });

  $("#save-scenario").addEventListener("click", saveScenario);
  $("#scenario-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveScenario();
  });
  $("#clear-scenarios").addEventListener("click", clearScenarios);

  $("#scenarios").addEventListener("click", (event) => {
    const load = event.target.closest("[data-load]");
    const del = event.target.closest("[data-delete]");
    if (load) loadScenario(num(load.dataset.load));
    if (del) {
      const index = num(del.dataset.delete);
      const removed = state.scenarios[index];
      state.scenarios.splice(index, 1);
      storeJSON("novaestate.atelier.scenarios", state.scenarios);
      renderScenarios();
      if (removed) toast(`Removed “${removed.name}”`);
    }
  });

  $("#hood-switch").addEventListener("change", (event) => {
    state.house.Neighborhood = event.target.value;
    state.presetKey = null;
    syncForm();
    renderStudio();
    toast(`Moved to ${event.target.value}`);
  });

  $("#compare-toggle").addEventListener("click", () => {
    const tray = $("#compare-tray");
    tray.classList.toggle("open");
    $("#compare-toggle").setAttribute("aria-expanded", tray.classList.contains("open") ? "true" : "false");
  });
  $("#compare-unpin").addEventListener("click", unpinCompare);

  $("#market-quality").addEventListener("input", (event) => {
    $("#market-quality-out").textContent = event.target.value;
    renderMarketScatter();
  });
  $("#market-hood").addEventListener("change", () => {
    renderHoodBars();
    renderHoodDetail($("#market-hood").value);
    renderMarketScatter();
  });

  $("#hood-bars").addEventListener("click", (event) => {
    const button = event.target.closest("[data-hood]");
    if (!button) return;
    const name = button.dataset.hood;
    $("#market-hood").value = name;
    renderHoodBars();
    renderHoodDetail(name);
    renderMarketScatter();
    requestAnimationFrame(() => $("#hood-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }));
  });

  $("#hood-use").addEventListener("click", () => {
    const name = $("#market-hood").value;
    if (!name) return;
    state.house.Neighborhood = name;
    state.presetKey = null;
    syncForm();
    renderStudio();
    showView("studio");
    setTimeout(() => $("#view-studio .studio-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    toast(`Now reading a home in ${name}`);
  });

  attachScatterHover();
  setupPortrait();

  $("#palette-input").addEventListener("input", (event) => {
    paletteActive = 0;
    renderPalette(event.target.value);
  });
  $("#palette-input").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); movePalette(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); movePalette(-1); }
    else if (event.key === "Enter") { event.preventDefault(); runPalette(paletteActive); }
    else if (event.key === "Escape") { event.preventDefault(); closePalette(); }
  });
  $("#palette-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-index]");
    if (button) runPalette(num(button.dataset.paletteIndex));
  });
  $("#palette").addEventListener("click", (event) => {
    if (event.target === $("#palette")) closePalette();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if ($("#palette").classList.contains("hidden")) openPalette();
      else closePalette();
      return;
    }
    if (event.key === "Escape") {
      closePalette();
      return;
    }
    const tag = event.target.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (!$("#palette").classList.contains("hidden")) return;
    const key = event.key.toLowerCase();
    if (key === "1") showView("studio");
    else if (key === "2") showView("market");
    else if (key === "3") showView("model");
    else if (key === "r") resetHome();
    else if (key === "p") pinCurrent();
    else if (key === "s") saveScenario();
    else if (key === "?") toast("1 studio · 2 market · 3 model · K search · P pin · S save · R reset");
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === "market") {
        renderMarketScatter();
        renderDistribution();
      }
      if (state.view === "model") drawParity();
    }, 150);
  });
}

/* --------------------------------------------------------------------- reveal */

function setupReveal() {
  const elements = $$(".section, .market-grid, .market-lower, .two-col, .mini-grid.wide");
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("in"));
    return;
  }
  elements.forEach((element) => element.classList.add("reveal"));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.06, rootMargin: "0px 0px -40px 0px" }
  );
  elements.forEach((element) => observer.observe(element));
}

/* ---------------------------------------------------------------------- boot */

renderHeroFacts();
buildForms();
buildMarketSelect();
syncForm();
syncQuick();
renderStudio();
renderScenarios();
buildPalette();
setupReveal();
bindEvents();

const initial = location.hash.replace("#", "");
showView(["studio", "market", "model"].includes(initial) ? initial : "studio", { silent: true, noHash: true });

loaderBar.style.width = "100%";
loaderNote.textContent = "Ready";
setTimeout(() => {
  document.body.classList.add("ready");
  setTimeout(() => { $("#loader").style.display = "none"; }, 900);
}, 240);

