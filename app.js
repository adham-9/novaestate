import { Estimator, formatOption } from "./predict.js";

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
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const bundle = await fetch("./model.json").then((response) => {
  if (!response.ok) throw new Error(`Could not load model.json (${response.status})`);
  return response.json();
});
const est = new Estimator(bundle);

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
const state = {
  house: { ...bundle.defaults },
  view: "studio",
  scenarios: loadScenarios(),
  activeExplain: "drivers",
  lastPrice: 0,
  levers: [],
};

/* ------------------------------------------------------------------ helpers */

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

function loadScenarios() {
  try {
    const raw = localStorage.getItem("novaestate.scenarios");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistScenarios() {
  try {
    localStorage.setItem("novaestate.scenarios", JSON.stringify(state.scenarios));
  } catch {
    /* storage may be unavailable */
  }
}

/* -------------------------------------------------------------------- hero */

function renderHero() {
  const m = bundle.metrics;
  const median = [...bundle.market].map((r) => r.p).sort((a, b) => a - b)[Math.floor(bundle.market.length / 2)];
  $("#hero-stats").innerHTML = [
    ["Homes analysed", Number(m.n_total).toLocaleString("en-US"), "Ames, 2006 – 2010"],
    ["Median sale", money(median), "whole dataset"],
    ["Validation R²", Number(m.r2).toFixed(3), "held-out homes"],
    ["Neighbourhoods", bundle.neighborhoods.length, "across Ames"],
  ]
    .map(
      ([k, v, s]) =>
        `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`
    )
    .join("");
}

/* ------------------------------------------------------------------- forms */

function controlHTML(field) {
  const value = state.house[field] ?? bundle.defaults[field];
  const label = bundle.labels[field] || field;
  if (bundle.categories[field]) {
    const options = bundle.categories[field]
      .map((option) => {
        const selected = String(option) === String(value) ? " selected" : "";
        return `<option value="${esc(option)}"${selected}>${esc(formatOption(bundle, field, option))}</option>`;
      })
      .join("");
    return `<label class="field"><span class="flabel">${esc(label)}</span><select data-field="${field}">${options}</select></label>`;
  }

  const stats = bundle.numeric_stats[field];
  if (!stats) return "";
  const [lo, hi, step] = RANGES[field] || [
    Math.floor(stats.min),
    Math.ceil(stats.max),
    bundle.int_fields.includes(field) ? 1 : 10,
  ];
  const safe = Math.min(Math.max(num(value, stats.median), lo), hi);
  if (SLIDER.has(field)) {
    return `<label class="field"><span class="flabel">${esc(label)} <em data-out="${field}"></em></span>
      <input type="range" data-field="${field}" min="${lo}" max="${hi}" step="${step}" value="${Math.round(safe)}"></label>`;
  }
  return `<label class="field"><span class="flabel">${esc(label)}</span>
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
      (preset) =>
        `<button class="preset" data-preset="${preset.key}"><b>${esc(preset.name)}</b><small>${esc(preset.tagline)}</small></button>`
    )
    .join("");

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
}

function updateOutput(field) {
  const out = $(`[data-out="${field}"]`);
  if (!out) return;
  out.textContent = formatField(field, state.house[field]);
}

function syncForm() {
  $$("[data-field]").forEach((el) => {
    const field = el.dataset.field;
    const value = state.house[field] ?? bundle.defaults[field];
    if (el.tagName === "SELECT") {
      el.value = String(value);
    } else if (document.activeElement !== el) {
      el.value = value;
    }
    updateOutput(field);
  });
}

function handleControl(el) {
  const field = el.dataset.field;
  if (!field) return;
  let value = el.tagName === "SELECT" ? el.value : Number(el.value);
  if (el.type === "number" && el.value === "") value = bundle.defaults[field];
  state.house[field] = value;
  updateOutput(field);
  schedule();
}

/* --------------------------------------------------------------- rendering */

let framePending = false;
function schedule() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    renderStudio();
  });
}

function animatePrice(target) {
  const el = $("#price-value");
  const from = state.lastPrice;
  state.lastPrice = target;
  const start = performance.now();
  const duration = 520;
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = money(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function estimate() {
  const clean = est.sanitize(state.house);
  const price = est.predict(clean);
  const [low, high] = est.band(price);
  return { clean, price, low, high };
}

function barRows(items, { signed = true, money: isMoney = true } = {}) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return items
    .map((item) => {
      const width = Math.max(2, (Math.abs(item.value) / max) * 100);
      const cls = item.value < 0 ? "neg" : item.positive === false ? "" : "";
      const valueText = isMoney
        ? `${signed && item.value >= 0 ? "+" : signed ? "−" : ""}${money(Math.abs(item.value))}`
        : `${(item.value * 100).toFixed(0)}%`;
      return `<div class="bar-row">
        <span class="bar-label" title="${esc(item.label)}">${esc(item.label)}</span>
        <div class="bar-track"><i class="${cls}" style="width:${width}%"></i></div>
        <span class="bar-value">${valueText}</span>
      </div>`;
    })
    .join("");
}

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
  $("#price-ppsf").textContent = `${money(ppsf)} / sq ft`;
  $("#price-footnote").textContent = `${confidence.toFixed(0)}% within 10%`;
  $("#price-meter").style.width = `${Math.max(4, Math.min(100, confidence))}%`;
  animatePrice(price);

  let badge = "In line";
  let tone = "cool";
  let message = "<b>In line with</b> the median of six nearby sales";
  if (gap >= 0.06) {
    badge = "Above comps";
    tone = "warm";
    message = `<b>${(gap * 100).toFixed(0)}% above</b> the median of six nearby sales`;
  } else if (gap <= -0.06) {
    badge = "Below comps";
    tone = "";
    message = `<b>${Math.abs(gap * 100).toFixed(0)}% below</b> the median of six nearby sales`;
  }
  $("#price-badge").textContent = badge;
  $("#price-badge").className = `badge ${tone}`;

  $("#studio-signal").innerHTML = `
    <span class="flag ${tone}">● ${badge}</span>
    <div class="note">A ${quality}/10 quality, ${area.toLocaleString("en-US")} sq ft home in
      ${esc(clean.Neighborhood)}. The model prices it at <b>${money(ppsf)} per sq ft</b>,
      against a neighbourhood median of <b>${money(hood.median_price)}</b>.
      ${message}.</div>`;

  $("#studio-minis").innerHTML = [
    ["Price per sq ft", money(ppsf), `vs ${money(hood.median_ppsf)} nearby`],
    ["Neighbourhood", clean.Neighborhood, `${hood.homes} sales on record`],
    ["Living area", `${Math.round(area).toLocaleString("en-US")} sq ft`, `${Math.round(num(clean.BedroomAbvGr))} bed · ${Math.round(num(clean.FullBath))} bath`],
  ]
    .map(
      ([k, v, s]) => `<div class="mini"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`
    )
    .join("");

  // drivers -------------------------------------------------------------
  const drivers = est.drivers(clean, price, 9).map((row) => ({
    ...row,
    label: bundle.labels[row.column] || row.column,
  }));
  $("#drivers-chart").innerHTML = barRows(
    drivers.map((row) => ({ label: row.label, value: row.impact }))
  );
  $("#drivers-table").innerHTML = `
    <table><thead><tr><th>Driver</th><th>This home</th><th>Typical</th><th class="num">Impact</th></tr></thead>
    <tbody>${drivers
      .map(
        (row) => `<tr><td>${esc(row.label)}</td><td>${esc(formatField(row.column, clean[row.column], true))}</td>
        <td>${esc(formatField(row.column, bundle.defaults[row.column], true))}</td>
        <td class="num" style="color:${row.impact >= 0 ? "var(--forest)" : "var(--danger)"}">${row.impact >= 0 ? "+" : "−"}${money(Math.abs(row.impact))}</td></tr>`
      )
      .join("")}</tbody></table>`;

  // comparables ---------------------------------------------------------
  $("#comps-table").innerHTML = `
    <thead><tr><th>Neighbourhood</th><th class="num">Living area</th><th class="num">Quality</th>
    <th class="num">Built</th><th class="num">Basement</th><th class="num">Garage</th>
    <th class="num">Baths</th><th class="num">Sold for</th><th>Match</th></tr></thead>
    <tbody>${comps
      .map(
        (row) => `<tr><td>${esc(row.neighborhood)}</td><td class="num">${Math.round(row.area).toLocaleString("en-US")}</td>
        <td class="num">${row.quality}</td><td class="num">${row.built}</td>
        <td class="num">${Math.round(row.basement).toLocaleString("en-US")}</td>
        <td class="num">${Math.round(row.garage).toLocaleString("en-US")}</td>
        <td class="num">${row.baths}</td><td class="num">${money(row.price)}</td>
        <td><div class="match"><div class="bar-track"><i style="width:${row.match}%"></i></div><b>${row.match.toFixed(0)}%</b></div></td></tr>`
      )
      .join("")}</tbody>`;

  renderSensitivity(clean);
  renderLevers(clean);
  renderReport(clean, price, low, high, comps, drivers);
  renderScenarios();
}

function renderSensitivity(clean, priceOverride) {
  if (state.activeExplain !== "sensitivity" && priceOverride === undefined) {
    // Keep the select ready even when the panel is hidden.
  }
  const field = $("#sens-feature").value;
  if (!field) return;
  const points = est.sensitivity(clean, field, 26);
  const price = priceOverride ?? est.predict(clean);
  const current = num(clean[field], num(bundle.numeric_stats[field]?.median));
  $("#sens-value").innerHTML = `<div class="k">Current value</div><div class="v">${esc(formatField(field, current))}</div><div class="s">${esc(bundle.labels[field] || field)}</div>`;
  $("#sens-chart").innerHTML = lineChartSVG(points, current, price, field);
}

function lineChartSVG(points, current, price, field) {
  const width = 820;
  const height = 280;
  const pad = { l: 64, r: 18, t: 18, b: 38 };
  if (!points.length) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys, price);
  const ymax = Math.max(...ys, price);
  const sx = (x) => pad.l + ((x - xmin) / Math.max(xmax - xmin, 1)) * (width - pad.l - pad.r);
  const sy = (y) => height - pad.b - ((y - ymin) / Math.max(ymax - ymin, 1)) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const y = pad.t + t * (height - pad.t - pad.b);
      const value = ymax - t * (ymax - ymin);
      return `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="#E4DFD3" stroke-width="1"/>
        <text x="${pad.l - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#8A968E">${moneyShort(value)}</text>`;
    })
    .join("");
  const xTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const x = pad.l + t * (width - pad.l - pad.r);
      const value = xmin + t * (xmax - xmin);
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#8A968E">${Math.round(value).toLocaleString("en-US")}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sensitivity of ${esc(field)}">
    ${grid}${xTicks}
    <line x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}" stroke="#D8D2C4"/>
    <path d="${path}" fill="none" stroke="#0E6B5C" stroke-width="2.6" stroke-linejoin="round"/>
    <circle cx="${sx(Math.min(Math.max(current, xmin), xmax))}" cy="${sy(price)}" r="6" fill="#C97B3C" stroke="#FFFDF8" stroke-width="2"/>
    <text x="${width - pad.r}" y="${pad.t + 4}" text-anchor="end" font-size="10" fill="#8A968E">${esc(bundle.labels[field] || field)}</text>
  </svg>`;
}

function renderLevers(clean) {
  state.levers = est.levers(clean);
  $("#levers").innerHTML = state.levers
    .map(
      (lever, index) => `<button class="lever" data-lever="${index}">
        <b>${esc(lever.label)}</b>
        <span class="delta ${lever.delta >= 0 ? "pos" : "neg"}">${lever.delta >= 0 ? "+" : "−"}${money(Math.abs(lever.delta))}</span>
      </button>`
    )
    .join("");
}

function renderReport(clean, price, low, high, comps, drivers) {
  const area = num(clean.GrLivArea);
  const ppsf = price / Math.max(area, 1);
  const lines = [
    `# NovaEstate appraisal — ${clean.Neighborhood}`,
    "",
    `**Estimated market value:** ${money(price)}  `,
    `**Likely range:** ${money(low)} – ${money(high)}  `,
    `**Price per sq ft:** ${money(ppsf)}  `,
    `**Home:** ${Math.round(area).toLocaleString("en-US")} sq ft · ${Math.round(num(clean.OverallQual))}/10 quality · built ${Math.round(num(clean.YearBuilt))}`,
    "",
    "## What shapes the estimate",
    "",
    "| Driver | This home | Typical | Impact |",
    "| --- | --- | --- | --- |",
    ...drivers.slice(0, 7).map(
      (row) =>
        `| ${row.label} | ${formatField(row.column, clean[row.column], true)} | ${formatField(row.column, bundle.defaults[row.column], true)} | ${money(Math.abs(row.impact))} ${row.impact >= 0 ? "lift" : "drag"} |`
    ),
    "",
    "## Comparable sales",
    "",
    "| Neighbourhood | Living area | Quality | Built | Sold for | Match |",
    "| --- | --- | --- | --- | --- | --- |",
    ...comps.slice(0, 5).map(
      (row) =>
        `| ${row.neighborhood} | ${Math.round(row.area).toLocaleString("en-US")} | ${row.quality} | ${row.built} | ${money(row.price)} | ${row.match.toFixed(0)}% |`
    ),
    "",
    `*Model: Ridge regression on ${Number(bundle.metrics.n_total).toLocaleString("en-US")} Ames sales. Validation R² ${Number(bundle.metrics.r2).toFixed(3)}, MAE ${money(bundle.metrics.mae)}. A decision aid, not a licensed appraisal.*`,
  ];
  $("#report-preview").textContent = lines.join("\n");
  $("#report-preview").dataset.report = lines.join("\n");
}

function renderScenarios() {
  $("#scenario-count").textContent = `${state.scenarios.length} saved`;
  $("#export-json").disabled = !state.scenarios.length;
  $("#clear-scenarios").disabled = !state.scenarios.length;
  if (!state.scenarios.length) {
    $("#scenarios").innerHTML = `<div class="empty">No saved valuations yet. Shape a home and save it to build a comparison set.</div>`;
    return;
  }
  $("#scenarios").innerHTML = state.scenarios
    .map(
      (scenario, index) => `<div class="scenario">
        <div><div class="name">${esc(scenario.name)}</div><div class="meta">${esc(scenario.detail)}</div></div>
        <div class="price">${money(scenario.price)}</div>
        <div class="actions">
          <button class="icon-btn" data-load="${index}" title="Load">Load</button>
          <button class="icon-btn" data-delete="${index}" title="Delete">✕</button>
        </div>
      </div>`
    )
    .join("");
}

/* ------------------------------------------------------------------- market */

function qualityColor(quality) {
  const q = Math.max(1, Math.min(10, quality));
  const t = (q - 1) / 9;
  const r = Math.round(60 + (10 - 60) * t);
  const g = Math.round(110 + (90 - 110) * t);
  const b = Math.round(140 + (110 - 140) * t);
  return `rgba(${r},${g},${b},0.55)`;
}

function setupCanvas(canvas, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(canvas.clientWidth, 320);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawAxes(ctx, width, height, pad, yLabel, xLabel, yTicks, xTicks, yFormat, xFormat) {
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = "#8A968E";
  ctx.strokeStyle = "#E4DFD3";
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
  ctx.fillStyle = "#6C756E";
  ctx.fillText(yLabel, pad.l, 13);
  ctx.textAlign = "right";
  ctx.fillText(xLabel, width - pad.r, height - 5);
  ctx.textAlign = "left";
}

function renderMarketScatter() {
  const canvas = $("#market-scatter");
  if (!canvas || !canvas.clientWidth) return;
  const { ctx, width, height } = setupCanvas(canvas, 380);
  const pad = { l: 58, r: 16, t: 30, b: 46 };
  const minQuality = num($("#market-quality").value, 1);
  const hood = $("#market-hood").value;
  const rows = bundle.market.filter(
    (row) => row.q >= minQuality && row.a >= 300 && row.a <= 6500 && (!hood || row.n === hood)
  );
  const xs = rows.map((row) => row.a);
  const ys = rows.map((row) => row.p);
  const xmin = Math.min(...xs, 300);
  const xmax = Math.max(...xs, 6000);
  const ymin = Math.min(...ys, 50000);
  const ymax = Math.max(...ys, 800000);
  const sx = (x) => pad.l + ((x - xmin) / Math.max(xmax - xmin, 1)) * (width - pad.l - pad.r);
  const sy = (y) => height - pad.b - ((y - ymin) / Math.max(ymax - ymin, 1)) * (height - pad.t - pad.b);

  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, width, height, pad, "Sale price", "Living area", [ymin, ymin + (ymax - ymin) / 4, ymin + (ymax - ymin) / 2, ymin + (3 * (ymax - ymin)) / 4, ymax], [xmin, xmin + (xmax - xmin) / 4, xmin + (xmax - xmin) / 2, xmin + (3 * (xmax - xmin)) / 4, xmax], moneyShort, (v) => Math.round(v).toLocaleString("en-US"));

  for (const row of rows) {
    ctx.fillStyle = qualityColor(row.q);
    ctx.beginPath();
    ctx.arc(sx(row.a), sy(row.p), row.q >= 8 ? 3.4 : 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const clean = est.sanitize(state.house);
  if (!hood || hood === clean.Neighborhood) {
    const x = sx(Math.min(Math.max(num(clean.GrLivArea), xmin), xmax));
    const y = sy(Math.min(Math.max(est.predict(clean), ymin), ymax));
    ctx.strokeStyle = "#C97B3C";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#C97B3C";
    ctx.font = "600 10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("This home", x + 12, y + 3);
  }

  $("#market-count").textContent = `${rows.length.toLocaleString("en-US")} sales shown`;
}

function renderMarket() {
  const prices = bundle.market.map((row) => row.p);
  const med = prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const ppsf = bundle.market.map((row) => row.p / Math.max(row.a, 1)).sort((a, b) => a - b);
  $("#market-stats").innerHTML = [
    ["Sales on record", bundle.market.length.toLocaleString("en-US"), "Ames · 2006–2010"],
    ["Median sale", money(med), "all neighbourhoods"],
    ["Median $/sq ft", money(ppsf[Math.floor(ppsf.length / 2)]), "across the city"],
  ]
    .map(([k, v, s]) => `<div class="mini"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`)
    .join("");

  const max = Math.max(...bundle.neighborhoods.map((row) => row.median_price));
  $("#hood-bars").innerHTML = bundle.neighborhoods
    .map(
      (row) => `<div class="hood-row"><span class="n" title="${esc(row.Neighborhood)}">${esc(row.Neighborhood)}</span>
        <div class="bar-track"><i style="width:${(row.median_price / max) * 100}%"></i></div>
        <span class="v">${moneyShort(row.median_price)}</span></div>`
    )
    .join("");

  const hoodOptions = [...new Set(bundle.market.map((row) => row.n))].sort();
  if ($("#market-hood").options.length <= 1) {
    $("#market-hood").insertAdjacentHTML(
      "beforeend",
      hoodOptions.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")
    );
  }
  renderMarketScatter();
}

/* -------------------------------------------------------------------- model */

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
    .map(([k, v, s]) => `<div class="mini"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`)
    .join("");

  drawParity();

  const coefs = bundle.top_coefficients.slice(0, 14).map((row) => ({
    label: row.name.replaceAll("_", " · "),
    value: row.value,
  }));
  const max = Math.max(...coefs.map((row) => Math.abs(row.value)), 0.0001);
  $("#coef-bars").innerHTML = coefs
    .map(
      (row) => `<div class="bar-row"><span class="bar-label" title="${esc(row.label)}">${esc(row.label)}</span>
        <div class="bar-track"><i class="${row.value < 0 ? "neg" : ""}" style="width:${(Math.abs(row.value) / max) * 100}%"></i></div>
        <span class="bar-value">${row.value.toFixed(2)}</span></div>`
    )
    .join("");

  const clean = est.sanitize(state.house);
  const contributions = est.contributions(clean);
  const groups = {};
  for (const [field, value] of Object.entries(contributions)) {
    const group = bundle.field_groups[field] || "Other";
    groups[group] = (groups[group] || 0) + value;
  }
  const groupRows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const groupMax = Math.max(...groupRows.map((row) => row[1]), 0.0001);
  $("#group-bars").innerHTML = groupRows
    .map(
      ([group, value]) => `<div class="bar-row"><span class="bar-label">${esc(group)}</span>
        <div class="bar-track"><i style="width:${(value / groupMax) * 100}%"></i></div>
        <span class="bar-value">${(value * 100).toFixed(0)}%</span></div>`
    )
    .join("");

  const steps = [
    ["1 · Coherence", "Living area, basement, garage and extras are reconciled before pricing."],
    ["2 · Engineering", "Age, total square footage, bathrooms, porches and presence flags are derived."],
    ["3 · Skew control", "Power and quantile transforms tame the long tails of area and value."],
    ["4 · Ridge", "245 encoded signals are combined, then mapped back from the transformed target."],
  ];
  $("#pipeline").innerHTML = steps
    .map(([k, v]) => `<div class="mini"><div class="k">${k}</div><div class="s" style="margin-top:0.4rem;line-height:1.5;font-size:0.76rem">${v}</div></div>`)
    .join("");
}

function drawParity() {
  const canvas = $("#parity");
  if (!canvas || !canvas.clientWidth) return;
  const { ctx, width, height } = setupCanvas(canvas, 380);
  const pad = { l: 58, r: 16, t: 30, b: 46 };
  const rows = bundle.validation;
  const lo = Math.min(...rows.map((row) => Math.min(row.a, row.p)));
  const hi = Math.max(...rows.map((row) => Math.max(row.a, row.p)));
  const sx = (v) => pad.l + ((v - lo) / Math.max(hi - lo, 1)) * (width - pad.l - pad.r);
  const sy = (v) => height - pad.b - ((v - lo) / Math.max(hi - lo, 1)) * (height - pad.t - pad.b);

  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, width, height, pad, "Predicted value", "Actual sale price", [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + (3 * (hi - lo)) / 4, hi], [lo, lo + (hi - lo) / 4, lo + (hi - lo) / 2, lo + (3 * (hi - lo)) / 4, hi], moneyShort, moneyShort);

  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "#C97B3C";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(sx(lo), sy(lo));
  ctx.lineTo(sx(hi), sy(hi));
  ctx.stroke();
  ctx.setLineDash([]);

  for (const row of rows) {
    ctx.fillStyle = "rgba(14,107,92,0.45)";
    ctx.beginPath();
    ctx.arc(sx(row.a), sy(row.p), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const residuals = rows.map((row) => row.a - row.p).sort((a, b) => a - b);
  $("#parity-caption").textContent = `Median residual ${money(residuals[Math.floor(residuals.length / 2)])} · ${rows.length} held-out homes.`;
}

/* --------------------------------------------------------------------- wiring */

$$("[data-view]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    showView(el.dataset.view);
  });
});

function showView(view) {
  state.view = view;
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "market") renderMarket();
  if (view === "model") renderModel();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#form-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-form]");
  if (!button) return;
  const form = button.dataset.form;
  $$("#form-switch button").forEach((b) => b.classList.toggle("active", b === button));
  $("#form-essentials").classList.toggle("hidden", form !== "essentials");
  $("#form-advanced").classList.toggle("hidden", form !== "advanced");
});

$("#explain-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-panel]");
  if (!button) return;
  state.activeExplain = button.dataset.panel;
  $$("#explain-tabs button").forEach((b) => b.classList.toggle("active", b === button));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.activeExplain}`));
  if (state.activeExplain === "sensitivity") {
    const { clean } = estimate();
    renderSensitivity(clean);
  }
});

document.addEventListener("input", (event) => {
  const el = event.target.closest("[data-field]");
  if (el) handleControl(el);
});
document.addEventListener("change", (event) => {
  const el = event.target.closest("[data-field]");
  if (el) handleControl(el);
});

$("#presets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  const preset = bundle.presets.find((item) => item.key === button.dataset.preset);
  if (!preset) return;
  state.house = structuredClone(preset.house);
  syncForm();
  renderStudio();
});

$("#sens-feature").addEventListener("change", () => {
  const { clean } = estimate();
  renderSensitivity(clean);
});

$("#levers").addEventListener("click", (event) => {
  const button = event.target.closest("[data-lever]");
  if (!button) return;
  const lever = state.levers[num(button.dataset.lever)];
  if (!lever) return;
  state.house = structuredClone(lever.house);
  syncForm();
  renderStudio();
});

$("#save-scenario").addEventListener("click", () => {
  const { clean, price } = estimate();
  const input = $("#scenario-name");
  const name = input.value.trim() || `${clean.Neighborhood} · ${Math.round(num(clean.GrLivArea))} sq ft`;
  state.scenarios.push({
    name,
    price,
    detail: `${clean.Neighborhood} · Q${Math.round(num(clean.OverallQual))} · ${Math.round(num(clean.GrLivArea)).toLocaleString("en-US")} sq ft`,
    house: structuredClone(clean),
  });
  persistScenarios();
  input.value = "";
  renderScenarios();
});

$("#scenarios").addEventListener("click", (event) => {
  const load = event.target.closest("[data-load]");
  const del = event.target.closest("[data-delete]");
  if (load) {
    const scenario = state.scenarios[num(load.dataset.load)];
    if (!scenario) return;
    state.house = structuredClone(scenario.house);
    syncForm();
    renderStudio();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (del) {
    state.scenarios.splice(num(del.dataset.delete), 1);
    persistScenarios();
    renderScenarios();
  }
});

$("#clear-scenarios").addEventListener("click", () => {
  state.scenarios = [];
  persistScenarios();
  renderScenarios();
});

$("#export-json").addEventListener("click", () => {
  const payload = JSON.stringify(
    state.scenarios.map(({ name, price, house }) => ({ name, price, house })),
    null,
    2
  );
  download("novaestate-scenarios.json", payload, "application/json");
});

$("#download-report").addEventListener("click", () => {
  const text = $("#report-preview").dataset.report || "";
  download("novaestate-appraisal.md", text, "text/markdown");
});

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


$("#market-quality").addEventListener("input", (event) => {
  $("#market-quality-out").textContent = event.target.value;
  renderMarketScatter();
});
$("#market-hood").addEventListener("change", renderMarketScatter);


let marketResize;
window.addEventListener("resize", () => {
  clearTimeout(marketResize);
  marketResize = setTimeout(() => {
    if (state.view === "market") renderMarketScatter();
    if (state.view === "model") drawParity();
  }, 120);
});

/* --------------------------------------------------------------------- boot */

renderHero();
buildForms();
syncForm();
renderStudio();
renderScenarios();
showView("studio");
