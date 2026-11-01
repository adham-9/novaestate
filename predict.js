/* NovaEstate client-side predictor.
 *
 * Mirrors housing_engine.py exactly: coherence rules, engineered features,
 * fitted skew transforms, imputers, scalers, encoders, Ridge coefficients and
 * the quantile target transform. No network, no dependencies.
 */

const EPS = 1e-12;

export function normCdf(z) {
  // Abramowitz & Stegun 7.1.26 via erf approximation.
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function normPpf(p) {
  // Peter Acklam's rational approximation, refined with one Newton step.
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q, r, x;

  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Newton refinement against the CDF.
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

function interp(x, xp, fp, leftSide = false) {
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  let lo = 0;
  let hi = xp.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (leftSide ? xp[mid] < x : xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xp[hi] - xp[lo];
  if (span === 0) return fp[lo];
  const t = (x - xp[lo]) / span;
  return fp[lo] + t * (fp[hi] - fp[lo]);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function powerTransform(x, method, lambda) {
  if (method === "box-cox") {
    if (Math.abs(lambda) < EPS) return Math.log(x);
    return (Math.pow(x, lambda) - 1) / lambda;
  }
  // Yeo-Johnson
  if (x >= 0) {
    if (Math.abs(lambda) < EPS) return Math.log1p(x);
    return (Math.pow(x + 1, lambda) - 1) / lambda;
  }
  if (Math.abs(lambda - 2) < EPS) return -Math.log1p(-x);
  return -(Math.pow(1 - x, 2 - lambda) - 1) / (2 - lambda);
}

function applyTransform(value, spec) {
  const filled = value == null || !Number.isFinite(value) ? spec.median : value;
  switch (spec.kind) {
    case "log":
      return Math.log1p(filled + (spec.shift ?? 0));
    case "sqrt":
      return Math.sqrt(Math.max(0, filled + (spec.shift ?? 0)));
    case "cbrt":
      return Math.cbrt(filled);
    case "reciprocal":
      return 1 / (filled + (spec.shift ?? 0));
    case "exponential":
      return Math.exp(Math.max(-5, Math.min(5, filled)));
    case "reflection":
      return Math.log1p(spec.constant - filled);
    case "quantile": {
      // sklearn averages the ascending and descending interpolation so that
      // repeated feature values land in the middle of their quantile run.
      const low = interp(filled, spec.quantiles, spec.references, true);
      const high = interp(filled, spec.quantiles, spec.references, false);
      let p = 0.5 * (low + high);
      p = Math.min(1 - 1e-7, Math.max(1e-7, p));
      return normPpf(p);
    }
    case "power":
      return powerTransform(filled, spec.method, spec.lambda);
    default:
      return filled;
  }
}

/* ------------------------------------------------------------------ model */

export class Estimator {
  constructor(bundle) {
    this.m = bundle;
    this.categories = bundle.categories || {};
    this.onehotSets = {};
    for (const [column, values] of Object.entries(bundle.onehot || {})) {
      this.onehotSets[column] = new Set(values.map((v) => String(v)));
    }
  }

  categoryValue(column, value) {
    const options = this.categories[column] || [];
    if (value == null) return options[0] ?? value;
    const text = String(value).trim().toLowerCase();
    for (const option of options) {
      if (String(option).trim().toLowerCase() === text) return option;
    }
    return value;
  }

  sanitize(source, keepNan = false) {
    const m = this.m;
    const h = { ...m.defaults };
    for (const [key, value] of Object.entries(source || {})) {
      if (key in h) h[key] = value;
    }

    for (const column of m.input_columns) {
      if (this.categories[column]) {
        h[column] = this.categoryValue(column, h[column]);
      } else {
        let value = Number(h[column]);
        if (!Number.isFinite(value)) value = num(m.defaults[column], 0);
        h[column] = value;
      }
    }

    // living space
    const gross = Math.max(num(h.GrLivArea), 0);
    const low = Math.min(Math.max(num(h.LowQualFinSF), 0), gross);
    const second = Math.min(Math.max(num(h["2ndFlrSF"]), 0), gross - low);
    const first = Math.max(gross - low - second, 0);
    h.GrLivArea = gross;
    h.LowQualFinSF = low;
    h["2ndFlrSF"] = second;
    h["1stFlrSF"] = first;

    // basement
    const basement = Math.max(num(h.TotalBsmtSF), 0);
    const fin1 = Math.min(Math.max(num(h.BsmtFinSF1), 0), basement);
    const fin2 = Math.min(Math.max(num(h.BsmtFinSF2), 0), basement - fin1);
    h.BsmtUnfSF = Math.max(basement - fin1 - fin2, 0);
    if (basement <= 0) {
      h.TotalBsmtSF = 0;
      h.BsmtFinSF1 = 0;
      h.BsmtFinSF2 = 0;
      h.BsmtUnfSF = 0;
      h.BsmtFullBath = 0;
      h.BsmtHalfBath = 0;
      for (const column of ["BsmtQual", "BsmtCond", "BsmtExposure", "BsmtFinType1", "BsmtFinType2"]) {
        h[column] = "NA";
      }
    } else {
      for (const column of ["BsmtQual", "BsmtCond", "BsmtFinType1", "BsmtFinType2"]) {
        if (h[column] === "NA") h[column] = "TA";
      }
      if (h.BsmtExposure === "NA") h.BsmtExposure = "No";
    }

    // garage
    const garageAbsent = String(h.GarageType) === "NA" || num(h.GarageCars) <= 0;
    if (garageAbsent) {
      h.GarageType = "NA";
      h.GarageCars = 0;
      h.GarageArea = 0;
      h.GarageYrBlt = keepNan ? null : num(h.YearBuilt);
      for (const column of ["GarageFinish", "GarageQual", "GarageCond"]) h[column] = "NA";
    } else {
      h.GarageCars = Math.max(num(h.GarageCars), 1);
      h.GarageArea = Math.max(num(h.GarageArea), 200);
      for (const column of ["GarageFinish", "GarageQual", "GarageCond"]) {
        if (h[column] === "NA") h[column] = column === "GarageFinish" ? "Unf" : "TA";
      }
      if (h.GarageYrBlt == null || !Number.isFinite(Number(h.GarageYrBlt))) {
        h.GarageYrBlt = num(h.YearBuilt);
      }
    }

    // fireplace / veneer / pool / extras
    if (num(h.Fireplaces) <= 0) {
      h.Fireplaces = 0;
      h.FireplaceQu = "NA";
    } else if (h.FireplaceQu === "NA") {
      h.FireplaceQu = "TA";
    }

    if (h.MasVnrType === "NA") h.MasVnrArea = 0;
    else if (num(h.MasVnrArea) <= 0) h.MasVnrArea = 120;

    if (num(h.PoolArea) <= 0) {
      h.PoolArea = 0;
      h.PoolQC = "NA";
    } else if (h.PoolQC === "NA") {
      h.PoolQC = "TA";
    }

    if (h.MiscFeature === "NA") h.MiscVal = 0;
    else if (num(h.MiscVal) <= 0) h.MiscVal = 500;

    // integer-ish fields
    for (const column of m.int_fields) {
      if (column === "GarageYrBlt" && (h[column] == null || !Number.isFinite(Number(h[column])))) continue;
      const value = Number(h[column]);
      if (Number.isFinite(value)) h[column] = Math.round(value);
    }

    return h;
  }

  prepare(house) {
    const m = this.m;
    const h = this.sanitize(house, false);
    const derived = {
      HouseAge: Math.max(num(h.YrSold) - num(h.YearBuilt), 0),
      RemodAge: Math.max(num(h.YrSold) - num(h.YearRemodAdd), 0),
      IsRemodeled: num(h.YearRemodAdd) !== num(h.YearBuilt) ? 1 : 0,
      IsNew: num(h.YrSold) === num(h.YearBuilt) ? 1 : 0,
      TotalSF: num(h.TotalBsmtSF) + num(h["1stFlrSF"]) + num(h["2ndFlrSF"]),
      TotalBath:
        num(h.FullBath) +
        num(h.BsmtFullBath) +
        0.5 * (num(h.HalfBath) + num(h.BsmtHalfBath)),
      TotalPorchSF:
        num(h.OpenPorchSF) +
        num(h.EnclosedPorch) +
        num(h["3SsnPorch"]) +
        num(h.ScreenPorch) +
        num(h.WoodDeckSF),
      HasPool: num(h.PoolArea) > 0 ? 1 : 0,
      Has2ndFloor: num(h["2ndFlrSF"]) > 0 ? 1 : 0,
      HasFireplace: num(h.Fireplaces) > 0 ? 1 : 0,
      HasGarage: num(h.GarageCars) > 0 ? 1 : 0,
      HasBasement: num(h.TotalBsmtSF) > 0 ? 1 : 0,
      HasBasementKnown: h.TotalBsmtSF != null ? 1 : 0,
    };
    const row = { ...h, ...derived };

    const values = {};
    for (const column of m.model_columns) {
      let value = row[column];
      const spec = m.transforms[column];
      if (spec) {
        value = applyTransform(value == null ? null : Number(value), spec);
      } else if (value != null && this.categories[column]) {
        value = String(value);
      } else {
        value = value == null ? null : Number(value);
      }
      values[column] = value;
    }
    return { house: h, values };
  }

  encode(house) {
    const m = this.m;
    const { values } = this.prepare(house);
    const vector = new Array(m.coefficients.length).fill(0);

    let index = 0;
    for (const column of m.numeric_features) {
      let value = values[column];
      const fill = m.impute.num[column];
      if (value == null || !Number.isFinite(value)) value = fill ?? 0;
      const mean = m.scaler.mean[index];
      const scale = m.scaler.scale[index];
      vector[index] = (value - mean) / scale;
      index += 1;
    }
    for (const column of m.nominal_features) {
      let value = values[column];
      if (value == null || value === "") value = m.impute.nom[column];
      const text = String(value);
      for (const category of m.onehot[column]) {
        vector[index] = text === String(category) ? 1 : 0;
        index += 1;
      }
    }
    for (const column of m.ordinal_features) {
      let value = values[column];
      if (value == null || value === "") value = m.impute.ord[column];
      const text = String(value);
      let encoded = m.ordinal[column].findIndex((c) => String(c) === text);
      if (encoded < 0) encoded = m.ordinal_unknown ?? -1;
      vector[index] = encoded;
      index += 1;
    }
    return { values, vector };
  }

  predict(house) {
    const m = this.m;
    const { vector } = this.encode(house);
    let z = m.intercept;
    for (let i = 0; i < vector.length; i += 1) {
      z += m.coefficients[i] * vector[i];
    }

    let p = normCdf(z);
    p = Math.min(1, Math.max(0, p));
    const raw = interp(p, m.target.references, m.target.quantiles) - (m.target.shift || 0);
    return Math.max(raw, 0);
  }

  band(price) {
    const [lo, hi] = this.m.band_ratios;
    return [
      Math.floor((price * lo) / 500) * 500,
      Math.ceil((price * hi) / 500) * 500,
    ];
  }

  contributions(house) {
    // Absolute influence by field in the transformed feature space.
    const m = this.m;
    const { values } = this.prepare(house);
    const totals = {};
    let index = 0;
    for (const column of m.numeric_features) {
      totals[column] = (totals[column] || 0) + Math.abs(m.coefficients[index] * (values[column] ?? 0));
      index += 1;
    }
    for (const column of m.nominal_features) {
      const text = String(values[column] ?? m.impute.nom[column]);
      let contribution = 0;
      for (const category of m.onehot[column]) {
        if (text === String(category)) contribution += m.coefficients[index];
        index += 1;
      }
      totals[column] = (totals[column] || 0) + Math.abs(contribution);
    }
    for (const column of m.ordinal_features) {
      const text = String(values[column] ?? m.impute.ord[column]);
      let encoded = m.ordinal[column].findIndex((c) => String(c) === text);
      if (encoded < 0) encoded = m.ordinal_unknown ?? -1;
      totals[column] = (totals[column] || 0) + Math.abs(m.coefficients[index] * encoded);
      index += 1;
    }
    return totals;
  }

  sensitivity(house, feature, points = 24) {
    const stats = this.m.numeric_stats[feature];
    if (!stats) return [];
    const clean = this.sanitize(house, false);
    const current = num(clean[feature], stats.median);
    let lo = Math.min(stats.q05, current);
    let hi = Math.max(stats.q95, current);
    if (hi <= lo) hi = lo + 1;
    const step = (hi - lo) / Math.max(points - 1, 1);
    const out = [];
    for (let i = 0; i < points; i += 1) {
      let x = lo + step * i;
      if (this.m.int_fields.includes(feature)) x = Math.round(x);
      const variant = { ...clean, [feature]: x };
      out.push({ x, y: this.predict(variant) });
    }
    return out;
  }

  drivers(house, price, n = 8) {
    const m = this.m;
    const clean = this.sanitize(house, false);
    const totals = this.contributions(clean);
    const baseline = m.defaults;
    const ranked = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(n * 3, n))
      .map(([column]) => column);

    const rows = [];
    for (const column of ranked) {
      if (column in baseline) {
        const variant = { ...clean, [column]: baseline[column] };
        const delta = price - this.predict(variant);
        rows.push({ column, impact: delta });
      }
    }
    rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    return rows.slice(0, n);
  }

  comps(house, n = 6) {
    const m = this.m;
    const clean = this.sanitize(house, false);
    const weights = {
      GrLivArea: 1.4, OverallQual: 1.2, YearBuilt: 0.9, TotalBsmtSF: 0.7,
      GarageArea: 0.6, LotArea: 0.5, FullBath: 0.5, Fireplaces: 0.3,
      TotRmsAbvGrd: 0.3, OverallCond: 0.3,
    };
    const stats = m.numeric_stats;
    const rows = m.market.map((row) => {
      const values = {
        GrLivArea: row.a,
        OverallQual: row.q,
        YearBuilt: row.y,
        TotalBsmtSF: row.b,
        GarageArea: row.g,
        LotArea: row.l,
        FullBath: row.f,
        Fireplaces: row.fp,
        TotRmsAbvGrd: row.tr,
        OverallCond: row.oc,
      };
      let distance = 0;
      for (const [column, weight] of Object.entries(weights)) {
        const stat = stats[column];
        if (!stat) continue;
        const target = num(clean[column], stat.median);
        const scale = Math.max(stat.std, 1);
        distance += weight * Math.pow((num(values[column], target) - target) / scale, 2);
      }
      if (String(row.n) === String(clean.Neighborhood)) distance *= 0.55;
      else distance += 0.35;
      return { row, distance };
    });
    rows.sort((a, b) => a.distance - b.distance);
    const pool = rows.slice(0, Math.max(n * 3, n));
    const max = pool[pool.length - 1]?.distance || 1;
    return pool.slice(0, n).map((item) => ({
      neighborhood: item.row.n,
      area: item.row.a,
      quality: item.row.q,
      built: item.row.y,
      basement: item.row.b,
      garage: item.row.g,
      baths: item.row.f,
      price: item.row.p,
      match: Math.max(0, Math.min(100, 100 * (1 - item.distance / max))),
    }));
  }

  neighborhood(house) {
    const name = String(this.sanitize(house, false).Neighborhood);
    return this.m.neighborhoods.find((row) => String(row.Neighborhood) === name)
      || this.m.neighborhoods[0];
  }

  levers(house) {
    const clean = this.sanitize(house, false);
    const base = this.predict(clean);
    const variants = [];
    const add = (label, patch) => variants.push({ label, house: { ...clean, ...patch } });

    add("Lift overall quality +1", { OverallQual: Math.min(10, num(clean.OverallQual) + 1) });
    add("Upgrade kitchen to excellent", { KitchenQual: "Ex" });
    add("Add 250 sq ft of living space", { GrLivArea: num(clean.GrLivArea) + 250 });
    if (num(clean.GarageCars) < 2) {
      add("Add garage capacity", {
        GarageCars: 2,
        GarageArea: Math.max(num(clean.GarageArea), 440),
        GarageType: clean.GarageType === "NA" ? "Attchd" : clean.GarageType,
      });
    } else {
      add("Add garage capacity", {
        GarageCars: num(clean.GarageCars) + 1,
        GarageArea: num(clean.GarageArea) + 200,
      });
    }
    if (num(clean.TotalBsmtSF) === 0) {
      add("Expand basement by 300 sq ft", { TotalBsmtSF: 800, BsmtFinSF1: 400 });
    } else {
      add("Expand basement by 300 sq ft", { TotalBsmtSF: num(clean.TotalBsmtSF) + 300 });
    }
    if (num(clean.Fireplaces) === 0) {
      add("Add a fireplace", { Fireplaces: 1, FireplaceQu: "Gd" });
    } else {
      add("Add a fireplace", { Fireplaces: num(clean.Fireplaces) + 1 });
    }
    if (num(clean.PoolArea) === 0) {
      add("Add a pool", { PoolArea: 400, PoolQC: "Gd" });
    } else {
      add("Add a pool", { PoolArea: num(clean.PoolArea) + 150 });
    }

    return variants.map((item) => ({
      ...item,
      price: this.predict(item.house),
      delta: this.predict(item.house) - base,
    }));
  }
}

/* ------------------------------------------------------------------ helpers */

export function formatOption(bundle, column, value) {
  const code = String(value);
  const labels = bundle.labels?.[column];
  const option = bundle.option_descriptions?.[column]?.[code];
  const quality = {
    NA: "None", Po: "Poor", Fa: "Fair", TA: "Typical", Gd: "Good", Ex: "Excellent",
    Unf: "Unfinished", LwQ: "Low quality", Rec: "Recreation room", BLQ: "Below average",
    ALQ: "Average", GLQ: "Good living quarters", No: "No exposure", Mn: "Minimal",
    Av: "Average", MnWw: "Minimum wood/wire", GdWo: "Good wood", MnPrv: "Minimum privacy",
    GdPrv: "Good privacy", RFn: "Rough finished", Fin: "Finished",
  }[code];
  const friendly = option || quality;
  if (friendly && friendly.trim().toLowerCase() !== code.trim().toLowerCase()) {
    return `${code} — ${friendly}`;
  }
  return labels && labels[column] ? code : code;
}

export function describe(bundle, column) {
  return bundle.descriptions?.[column] || bundle.labels?.[column] || column;
}
