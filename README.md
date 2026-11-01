# NovaEstate

An interactive Ames, Iowa housing valuation studio. It runs the real trained Ridge
model in the browser, so every number on the site is produced by the fitted pipeline
rather than a mock.

**Live site:** https://novaestate-ames.vercel.app

## What it does

- **Studio** — shape a property (14 essentials plus 64 advanced fields) and watch the
  estimate reprice instantly, with a likely range, price per sq ft and a comp-based
  deal signal.
- **Explainability** — value drivers measured against a typical Ames home, a
  sensitivity curve for any single feature, and the six closest recorded sales.
- **What-if levers** — one-click improvements, each repriced against the current home.
- **Scenario book** — save valuations locally and export a Markdown appraisal.
- **Market explorer** — neighbourhood medians and a quality/living-area/price scatter
  for all 2,930 recorded sales.
- **Model insights** — held-out R², RMSE, MAE, within-10% share, predicted-versus-actual
  parity and the strongest coefficients.

## Model

| | |
| --- | --- |
| Algorithm | Ridge regression, 245 encoded features |
| Target | `SalePrice`, QuantileTransformer(normal), predictions inverse-transformed to dollars |
| Validation | R² 0.9309 · RMSE $23,159 · MAE $14,574 · MAPE 8.22% · 75.7% within 10% |
| Data | 2,930 Ames sales, 2006–2010 |

The fitted preprocessor, coefficients and dataset statistics are exported to
`model.json` by `export_web_model.py` in the parent project. `predict.js` reimplements
the exact Python pipeline (sanitising, feature engineering, encoding, scaling,
quantile transform, Ridge, inverse transform) and is parity-tested against the Python
engine on 34 cases with a worst deviation of 0.000058%.

## Stack

Plain HTML, CSS and ES modules. No build step, no runtime dependencies. The charts are
canvas and inline SVG; the numbers are computed client-side.

## Local development

```bash
python -m http.server 8000
# open http://localhost:8000
```

The site must be served over HTTP — ES modules and `fetch("./model.json")` do not work
from `file://`.

## Deploy

Hosted on Vercel as a static site. `vercel.json` sets clean URLs, a 1-hour cache on
`model.json` and basic security headers.
