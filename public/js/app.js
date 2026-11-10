'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  rows: [],
  datasetName: 'Bundled demo data (synthetic)',
  isDemo: true,
  series: [],
  forecast: [],
  latestPrice: null,
  currentModel: 'ensemble'
};

const MODEL_NAMES = {
  ensemble: 'Smart ensemble',
  ridge: 'Ridge ML (lag features)',
  linear: 'Linear regression',
  moving: 'Moving average'
};
const money = (value, decimals = 0) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value)
  : '—';
const number = (value, decimals = 0) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value)
  : '—';
const percent = (value, decimals = 1) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%` : '—';

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3300);
}

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCSV(text) {
  // A small CSV parser that handles quoted values and escaped quote characters.
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(item => item !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some(item => item !== '')) rows.push(row);
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted value. Check the file and try again.');
  if (rows.length < 2) throw new Error('The CSV does not contain a header and data rows.');
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => {
    const item = {};
    headers.forEach((header, index) => { item[header] = values[index] ?? ''; });
    return item;
  });
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return dateKey(value);
  const text = String(value ?? '').trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return validatedDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    // For ambiguous day/month formats, interpret the common Indian CSV convention as DD/MM/YYYY.
    return validatedDateKey(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? dateKey(parsed) : null;
}

function validatedDateKey(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return dateKey(date);
}

function dateKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getField(row, candidateNames) {
  const headerLookup = new Map(Object.keys(row).map(key => [normalizeHeader(key), row[key]]));
  for (const name of candidateNames) {
    const value = headerLookup.get(normalizeHeader(name));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  // Many official market exports append units, e.g. "Modal Price (Rs./Quintal)".
  for (const name of candidateNames) {
    const normalizedName = normalizeHeader(name);
    if (normalizedName.length < 4) continue;
    for (const [header, value] of headerLookup.entries()) {
      if (header.startsWith(normalizedName) && value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return '';
}

function convertRows(inputRows) {
  const normalized = [];
  let skipped = 0;
  inputRows.forEach(raw => {
    const dateRaw = getField(raw, ['Arrival_Date', 'Arrival Date', 'Date', 'Trade_Date', 'Date_Of_Arrival', 'ArrivalDate']);
    const commodityRaw = getField(raw, ['Commodity', 'Commodity_Name', 'Commodity Name', 'Crop', 'Product']);
    const marketRaw = getField(raw, ['Market', 'Market_Name', 'Market Name', 'Mandi', 'Mandi_Name', 'APMC', 'Market Centre']);
    const modalRaw = getField(raw, ['Modal_Price', 'Modal Price', 'ModalPrice', 'Price', 'Avg_Price', 'Average_Price', 'Market_Price', 'Price_Per_Quintal', 'Modal']);
    const minRaw = getField(raw, ['Min_Price', 'Min Price', 'Minimum_Price', 'MinPrice']);
    const maxRaw = getField(raw, ['Max_Price', 'Max Price', 'Maximum_Price', 'MaxPrice']);
    const date = parseDate(dateRaw);
    const priceVal = String(modalRaw).replace(/[₹,\s]/g, '');
    let price = Number(priceVal);
    const minPrice = Number(String(minRaw).replace(/[₹,\s]/g, ''));
    const maxPrice = Number(String(maxRaw).replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(price) || price <= 0) {
      if (Number.isFinite(minPrice) && minPrice > 0 && Number.isFinite(maxPrice) && maxPrice > 0) price = (minPrice + maxPrice) / 2;
      else if (Number.isFinite(maxPrice) && maxPrice > 0) price = maxPrice;
      else if (Number.isFinite(minPrice) && minPrice > 0) price = minPrice;
    }
    const commodity = String(commodityRaw || 'Unspecified commodity').trim();
    const market = String(marketRaw || 'Unspecified market').trim();
    if (!date || !Number.isFinite(price) || price <= 0) {
      skipped++;
      return;
    }
    normalized.push({ date, commodity, market, price });
  });
  if (!normalized.length) {
    throw new Error('No usable rows found. Include a date column and a positive Modal_Price (or Min_Price / Max_Price) column.');
  }
  return { rows: normalized, skipped };
}

async function loadBundledDataset() {
  try {
    const response = await fetch('/data/sample_prices.csv', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load bundled sample CSV.');
    const text = await response.text();
    const converted = convertRows(parseCSV(text));
    state.rows = converted.rows;
    state.datasetName = 'Bundled demo data (synthetic)';
    state.isDemo = true;
    $('#datasetStatus').textContent = 'DEMO DATA';
    $('#datasetName').textContent = 'Bundled demo data';
    populateSelectors(true);
    updateDatasetFacts();
    renderDashboard();
  } catch (error) {
    console.error(error);
    showToast('Dataset could not load. Run the project using npm start, then refresh.');
    $('#chartEmpty').classList.remove('hidden');
  }
}

function uniqueSorted(field) {
  return [...new Set(state.rows.map(row => row[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function populateSelectors(chooseFirst = false) {
  const commodities = uniqueSorted('commodity');
  const oldCommodity = $('#commoditySelect').value;
  $('#commoditySelect').innerHTML = commodities.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (!chooseFirst && commodities.includes(oldCommodity)) $('#commoditySelect').value = oldCommodity;
  populateMarketSelector(chooseFirst);
}

function populateMarketSelector(chooseFirst = false) {
  const commodity = $('#commoditySelect').value;
  const markets = [...new Set(state.rows
    .filter(row => row.commodity === commodity)
    .map(row => row.market)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const oldMarket = $('#marketSelect').value;
  const marketOptions = ['All markets', ...markets];
  $('#marketSelect').innerHTML = marketOptions.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (!chooseFirst && marketOptions.includes(oldMarket)) $('#marketSelect').value = oldMarket;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function updateDatasetFacts() {
  const dates = state.rows.map(row => row.date).sort();
  $('#datasetRows').textContent = number(state.rows.length);
  $('#datasetCommodities').textContent = number(uniqueSorted('commodity').length);
  $('#datasetMarkets').textContent = number(uniqueSorted('market').length);
  $('#datasetDates').textContent = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '—';
  $('#datasetName').textContent = state.datasetName;
  $('#observationCount').textContent = number(state.rows.length);
}

function getSelectedSeries() {
  const commodity = $('#commoditySelect').value;
  const market = $('#marketSelect').value;
  const filtered = state.rows.filter(row => row.commodity === commodity && (market === 'All markets' || row.market === market));
  const byDate = new Map();
  for (const row of filtered) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row.price);
  }
  return [...byDate.entries()].map(([date, values]) => ({ date, price: values.reduce((sum, value) => sum + value, 0) / values.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fitLinear(y) {
  const n = y.length;
  if (!n) return { intercept: 0, slope: 0 };
  const meanX = (n - 1) / 2;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (y[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  return { intercept: meanY - slope * meanX, slope };
}

function predictLinear(history, horizon) {
  const y = history.map(point => point.price);
  const { intercept, slope } = fitLinear(y);
  return Array.from({ length: horizon }, (_, i) => Math.max(0, intercept + slope * (y.length + i)));
}

function predictMoving(history, horizon) {
  const y = history.map(point => point.price);
  const windowSize = Math.min(7, y.length);
  const recent = y.slice(-windowSize);
  const avg = recent.reduce((sum, v) => sum + v, 0) / (recent.length || 1);
  const diffs = y.slice(-Math.min(8, Math.max(0, y.length - 1))).map((v, i, arr) => i ? v - arr[i - 1] : 0).slice(1);
  const drift = diffs.length ? diffs.reduce((sum, v) => sum + v, 0) / diffs.length : 0;
  const safeDrift = Math.max(-avg * .025, Math.min(avg * .025, drift * .25));
  return Array.from({ length: horizon }, (_, i) => Math.max(0, avg + safeDrift * (i + 1)));
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    if (Math.abs(div) < 1e-10) continue;
    for (let j = col; j <= n; j++) a[col][j] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row, i) => Number.isFinite(row[n]) ? row[n] : 0);
}

function fitRidge(history) {
  const y = history.map(point => point.price);
  const minTrain = 10;
  if (y.length < minTrain) return null;
  const mean = y.reduce((sum, v) => sum + v, 0) / y.length;
  const variance = y.reduce((sum, v) => sum + (v - mean) ** 2, 0) / y.length;
  const sd = Math.sqrt(variance) || 1;
  const features = [], targets = [];
  for (let t = 7; t < y.length; t++) {
    const trend = t / y.length;
    features.push([1, (y[t - 1] - mean) / sd, (y[t - 2] - mean) / sd, (y[t - 3] - mean) / sd, (y[t - 7] - mean) / sd, trend]);
    targets.push((y[t] - mean) / sd);
  }
  const dim = features[0].length;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array(dim).fill(0);
  for (let i = 0; i < features.length; i++) {
    for (let j = 0; j < dim; j++) {
      xty[j] += features[i][j] * targets[i];
      for (let k = 0; k < dim; k++) xtx[j][k] += features[i][j] * features[i][k];
    }
  }
  const lambda = 2.5;
  for (let j = 1; j < dim; j++) xtx[j][j] += lambda;
  const beta = solveLinearSystem(xtx, xty);
  return { beta, mean, sd, originalLength: y.length, y };
}

function predictRidge(history, horizon) {
  const fitted = fitRidge(history);
  if (!fitted) return predictMoving(history, horizon);
  const { beta, mean, sd, originalLength, y } = fitted;
  const simulated = [...y];
  const result = [];
  for (let step = 0; step < horizon; step++) {
    const t = simulated.length;
    const feature = [1, (simulated[t - 1] - mean) / sd, (simulated[t - 2] - mean) / sd, (simulated[t - 3] - mean) / sd, (simulated[t - 7] - mean) / sd, t / originalLength];
    let pred = mean + sd * feature.reduce((sum, value, i) => sum + value * beta[i], 0);
    if (!Number.isFinite(pred)) pred = simulated.slice(-7).reduce((sum, v) => sum + v, 0) / Math.min(7, simulated.length);
    pred = Math.max(0, pred);
    result.push(pred);
    simulated.push(pred);
  }
  return result;
}

function predictModel(model, history, horizon) {
  if (model === 'linear') return predictLinear(history, horizon);
  if (model === 'moving') return predictMoving(history, horizon);
  if (model === 'ridge') return predictRidge(history, horizon);
  const forecasts = ['ridge', 'linear', 'moving'].map(name => predictModel(name, history, horizon));
  return Array.from({ length: horizon }, (_, i) => forecasts.reduce((sum, series) => sum + series[i], 0) / forecasts.length);
}

function calculateMetrics(actual, predicted) {
  if (!actual.length) return { mae: NaN, rmse: NaN, mape: NaN };
  let abs = 0, sq = 0, pct = 0, pctCount = 0;
  actual.forEach((value, i) => {
    const err = value - predicted[i];
    abs += Math.abs(err); sq += err * err;
    if (Math.abs(value) > 1e-8) { pct += Math.abs(err / value) * 100; pctCount++; }
  });
  return { mae: abs / actual.length, rmse: Math.sqrt(sq / actual.length), mape: pctCount ? pct / pctCount : NaN };
}

function evaluateModels(series) {
  const models = ['ridge', 'linear', 'moving'];
  const n = series.length;
  const testSize = Math.min(40, Math.max(5, Math.floor(n * .18)));
  const start = Math.max(8, n - testSize);
  const results = models.map(model => {
    const actual = [], predicted = [];
    for (let t = start; t < n; t++) {
      const train = series.slice(0, t);
      if (train.length < 8) continue;
      const prediction = predictModel(model, train, 1)[0];
      actual.push(series[t].price);
      predicted.push(prediction);
    }
    return { model, name: MODEL_NAMES[model], ...calculateMetrics(actual, predicted), testCount: actual.length };
  });
  const finiteErrors = results.map(r => r.mae).filter(Number.isFinite);
  if (finiteErrors.length) {
    const ensemblePredActual = [], ensemblePred = [];
    for (let t = start; t < n; t++) {
      const train = series.slice(0, t);
      const preds = models.map(model => predictModel(model, train, 1)[0]);
      ensemblePredActual.push(series[t].price);
      ensemblePred.push(preds.reduce((sum, value) => sum + value, 0) / preds.length);
    }
    results.push({ model: 'ensemble', name: MODEL_NAMES.ensemble, ...calculateMetrics(ensemblePredActual, ensemblePred), testCount: ensemblePredActual.length });
  }
  return results.sort((a, b) => (Number.isFinite(a.mae) ? a.mae : Infinity) - (Number.isFinite(b.mae) ? b.mae : Infinity));
}

function buildForecast(series, model, horizon, metrics) {
  const predictions = predictModel(model, series, horizon);
  const selectedMetric = metrics.find(item => item.model === model);
  const rmse = selectedMetric && Number.isFinite(selectedMetric.rmse) ? selectedMetric.rmse : (series.length > 1 ? standardDeviation(series.slice(1).map((p, i) => p.price - series[i].price)) : series[0].price * .05);
  const lastDate = dateFromKey(series[series.length - 1].date);
  const lastPrice = series[series.length - 1].price;
  return predictions.map((price, index) => {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + index + 1);
    const date = dateKey(d);
    const uncertainty = Math.max(rmse * 1.1, lastPrice * .025) * Math.sqrt(index + 1);
    const low = Math.max(0, price - uncertainty);
    const high = price + uncertainty;
    return { date, price, low, high, step: index + 1, change: (price - lastPrice) / lastPrice * 100 };
  });
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function displayDate(dateStr, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  return dateFromKey(dateStr).toLocaleDateString('en-IN', options);
}

function renderDashboard() {
  const series = getSelectedSeries();
  state.series = series;
  state.currentModel = $('#modelSelect').value;
  const horizon = Number($('#horizonSelect').value) || 30;
  $('#lastUpdated').textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  updateDatasetFacts();
  $('#datasetStatus').textContent = state.isDemo ? 'DEMO DATA' : 'IMPORTED CSV';
  $('#demoDataNotice').classList.toggle('hidden', !state.isDemo);
  if (series.length < 3) {
    state.forecast = [];
    state.latestPrice = null;
    $('#chartEmpty').classList.remove('hidden');
    $('#latestPrice').textContent = '—'; $('#forecastAvg').textContent = '—'; $('#priceChange').textContent = '—';
    $('#latestDate').textContent = 'Latest observation';
    $('#changeFoot').textContent = 'Forecast end vs latest';
    $('#changeTag').textContent = '—';
    $('#dateCoverage').textContent = 'Selected series';
    $('#forecastRowsCount').textContent = '—';
    $('#chartSubtitle').textContent = 'Historical prices and forecast';
    $('#chartRangeText').textContent = '—';
    $('#pulseSignal').textContent = 'Not enough data';
    $('#pulseSummary').textContent = 'Select a series with at least 3 valid observations to calculate a forecast.';
    $('#recentMove').textContent = '—';
    $('#volatility').textContent = '—';
    $('#localTip').textContent = 'At least 3 observations are required to create a forecast.';
    $('#guideDirection').textContent = 'Waiting for forecast';
    $('#guideDirectionNote').textContent = 'At least 3 observations are required.';
    $('#guideEndPrice').textContent = '—';
    $('#guideRange').textContent = 'Estimated range: —';
    $('#guideSummary').innerHTML = '<span class="guide-icon" aria-hidden="true">↗</span><div><strong>Not enough observations</strong><p>Select a series with at least 3 valid observations to view a market guide.</p></div>';
    $('#forecastTableBody').innerHTML = '<tr><td colspan="6" class="table-placeholder">At least 3 valid observations are needed for a forecast.</td></tr>';
    $('#modelMetricsBody').innerHTML = '<tr><td colspan="5" class="table-placeholder">Not enough historical observations to backtest the models.</td></tr>';
    $('#observationCount').textContent = number(series.length);
    drawChart([], []);
    return;
  }
  $('#chartEmpty').classList.add('hidden');
  const metrics = evaluateModels(series);
  const forecast = buildForecast(series, state.currentModel, horizon, metrics);
  state.forecast = forecast;
  state.latestPrice = series[series.length - 1].price;
  const latest = series[series.length - 1];
  const avgForecast = forecast.reduce((sum, item) => sum + item.price, 0) / forecast.length;
  const endChange = (forecast[forecast.length - 1].price - latest.price) / latest.price * 100;
  $('#latestPrice').textContent = money(latest.price);
  $('#latestDate').textContent = displayDate(latest.date);
  $('#forecastAvg').textContent = money(avgForecast);
  $('#forecastAvgFoot').textContent = `Next ${horizon} days`;
  $('#priceChange').textContent = percent(endChange);
  $('#changeFoot').textContent = `Day ${horizon} vs. latest`;
  $('#changeTag').textContent = endChange > 1 ? 'Upward' : endChange < -1 ? 'Downward' : 'Mostly flat';
  $('#changeTag').style.color = endChange > 1 ? '#478656' : endChange < -1 ? '#b96b4e' : '#778579';
  $('#observationCount').textContent = number(series.length);
  $('#dateCoverage').textContent = `${displayDate(series[0].date, { month: 'short', year: 'numeric' })} – ${displayDate(latest.date, { month: 'short', year: 'numeric' })}`;
  $('#chartSubtitle').textContent = `${$('#commoditySelect').value} · ${$('#marketSelect').value} · ${MODEL_NAMES[state.currentModel]}`;
  $('#chartDataStatus').textContent = state.isDemo ? 'Synthetic demo series' : 'Imported market series';
  $('#chartRangeText').textContent = `${displayDate(series[Math.max(0, series.length - 90)].date)} – ${displayDate(forecast[forecast.length - 1].date)}`;
  $('#forecastTableSubtitle').textContent = `${horizon}-day estimate · ${MODEL_NAMES[state.currentModel]}`;
  renderMarketPulse(series, forecast, endChange, metrics);
  renderMarketGuide(latest.price, forecast, endChange);
  renderMetrics(metrics, state.currentModel);
  renderForecastTable(forecast, latest.price);
  drawChart(series, forecast);
}


function renderMarketGuide(latestPrice, forecast, endChange) {
  if (!forecast || !forecast.length) return;
  const last = forecast[forecast.length - 1];
  const average = forecast.reduce((sum, point) => sum + point.price, 0) / forecast.length;
  const commodity = $('#commoditySelect').value;
  const market = $('#marketSelect').value;
  const direction = endChange > 1 ? 'Expected to rise' : endChange < -1 ? 'Expected to fall' : 'Likely to stay steady';
  const directionNote = endChange > 1
    ? `Model estimates about ${Math.abs(endChange).toFixed(1)}% higher by day ${forecast.length}.`
    : endChange < -1
      ? `Model estimates about ${Math.abs(endChange).toFixed(1)}% lower by day ${forecast.length}.`
      : `Model estimates a change of ${Math.abs(endChange).toFixed(1)}% by day ${forecast.length}.`;
  const range = `${money(last.low)} – ${money(last.high)}`;
  $('#guideDirection').textContent = direction;
  $('#guideDirectionNote').textContent = directionNote;
  $('#guideEndPrice').textContent = money(last.price);
  $('#guideRange').textContent = `Estimated range: ${range}`;
  const opening = endChange > 1
    ? `For ${commodity} in ${market}, the selected model points to a higher price over the next ${forecast.length} days. If you can store produce safely, compare the possible benefit of waiting with storage, spoilage, and transport costs.`
    : endChange < -1
      ? `For ${commodity} in ${market}, the selected model points to a lower price over the next ${forecast.length} days. Consider checking today’s rate and nearby mandis rather than relying on this forecast alone.`
      : `For ${commodity} in ${market}, the selected model points to a broadly steady price over the next ${forecast.length} days. Compare nearby markets and account for quality and transport costs.`;
  const demoNote = state.isDemo
    ? ' Important: these are demonstration prices, not official live mandi rates.'
    : ' This is an estimate from your uploaded history, not a live market quote.';
  $('#guideSummary').innerHTML = `<span class="guide-icon" aria-hidden="true">↗</span><div><strong>${escapeHtml(direction)} · ${escapeHtml(commodity)}</strong><p>${escapeHtml(opening + demoNote)}</p><p class="guide-average">Average forecast over this period: <strong>${money(average)}</strong> per quintal.</p></div>`;
}

function renderMarketPulse(series, forecast, endChange, metrics) {
  const recent = series.slice(-30).map(point => point.price);
  const prev = series.slice(-60, -30).map(point => point.price);
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const prevAvg = prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : recentAvg;
  const recentMove = prevAvg ? (recentAvg - prevAvg) / prevAvg * 100 : 0;
  const dailyChanges = series.slice(-30).slice(1).map((point, i) => (point.price - series.slice(-30)[i].price) / (series.slice(-30)[i].price || 1) * 100);
  const vol = standardDeviation(dailyChanges);
  const signal = endChange > 3 ? 'Positive bias' : endChange < -3 ? 'Negative bias' : 'Range-bound';
  $('#pulseSignal').textContent = signal;
  $('#pulseDot').style.background = endChange > 3 ? '#64a875' : endChange < -3 ? '#ca835e' : '#d0a34d';
  $('#pulseSummary').textContent = endChange > 3
    ? `The selected model points to a higher ${$('#commoditySelect').value.toLowerCase()} price over the next ${forecast.length} days. Check the range and backtest before acting.`
    : endChange < -3
      ? `The selected model points to softer prices over the next ${forecast.length} days. Actual market outcomes may diverge from this estimate.`
      : `The selected model suggests a relatively stable outlook over the next ${forecast.length} days, within an uncertain market range.`;
  $('#recentMove').textContent = percent(recentMove);
  $('#recentMove').style.color = recentMove > 0 ? '#438657' : recentMove < 0 ? '#b96b4e' : '#607164';
  $('#volatility').textContent = `${number(vol, 2)}%`;
  const best = [...metrics].filter(m => Number.isFinite(m.mae)).sort((a, b) => a.mae - b.mae)[0];
  $('#localTip').textContent = best ? `${best.name} has the lowest MAE in this holdout test (${money(best.mae)}). It may still perform differently on future market data.` : 'Upload more history to enable a stronger model comparison.';
}

function renderMetrics(metrics, selectedModel) {
  $('#modelMetricsBody').innerHTML = [...metrics]
    .sort((a, b) => (Number.isFinite(a.mae) ? a.mae : Infinity) - (Number.isFinite(b.mae) ? b.mae : Infinity))
    .map((metric, index) => {
      const status = index === 0 ? '<span class="rank-tag">TOP BACKTEST</span>' : metric.model === selectedModel ? '<span class="rank-tag selected-tag">SELECTED</span>' : '<span class="rank-tag warn-tag">BENCHMARK</span>';
      return `<tr><td>${escapeHtml(metric.name)}</td><td>${money(metric.mae)}</td><td>${money(metric.rmse)}</td><td>${Number.isFinite(metric.mape) ? number(metric.mape, 2) + '%' : '—'}</td><td>${status}</td></tr>`;
    }).join('');
}

function renderForecastTable(forecast, latestPrice) {
  $('#forecastTableBody').innerHTML = forecast.map(item => {
    const change = (item.price - latestPrice) / latestPrice * 100;
    const sign = change > 1 ? 'up' : change < -1 ? 'down' : 'flat';
    const signal = sign === 'up' ? '↑ Higher' : sign === 'down' ? '↓ Lower' : '→ Stable';
    return `<tr>
      <td>${displayDate(item.date)}</td><td>${dateFromKey(item.date).toLocaleDateString('en-IN', { weekday: 'short' })}</td>
      <td class="forecast-price">${money(item.price)}</td><td class="range-text">${money(item.low)} – ${money(item.high)}</td>
      <td class="change-value ${sign}">${percent(change)}</td><td><span class="signal-tag ${sign}">${signal}</span></td>
    </tr>`;
  }).join('');
  $('#forecastRowsCount').textContent = `${forecast.length} forecast days`;
}

function drawChart(series, forecast) {
  const canvas = $('#priceChart');
  const container = canvas.parentElement;
  const width = Math.max(280, container.clientWidth);
  const height = Math.max(200, container.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (!series.length) return;
  const historical = series.slice(-90);
  const historyValues = historical.map(p => p.price);
  const allVals = historyValues.concat(forecast.flatMap(p => [p.low, p.high, p.price]));
  let minY = Math.min(...allVals), maxY = Math.max(...allVals);
  const padY = Math.max((maxY - minY) * .12, maxY * .035, 30);
  minY = Math.max(0, minY - padY); maxY += padY;
  const left = 62, right = 15, top = 17, bottom = 32;
  const plotW = width - left - right, plotH = height - top - bottom;
  const total = Math.max(2, historical.length + forecast.length - 1);
  const x = i => left + i / total * plotW;
  const y = val => top + (maxY - val) / (maxY - minY || 1) * plotH;
  ctx.font = '10px DM Sans, sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = maxY - (maxY - minY) * i / 4;
    const yy = y(value);
    ctx.beginPath(); ctx.strokeStyle = '#edf1ec'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
    ctx.fillStyle = '#96a097'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(value / 100) * 100 >= 1000 ? `₹${(value / 1000).toFixed(1)}k` : `₹${Math.round(value)}`, left - 9, yy);
  }
  // Forecast confidence band.
  if (forecast.length) {
    const startIndex = historical.length - 1;
    ctx.beginPath();
    forecast.forEach((item, i) => { const idx = startIndex + i + 1; if (i === 0) ctx.moveTo(x(idx), y(item.high)); else ctx.lineTo(x(idx), y(item.high)); });
    for (let i = forecast.length - 1; i >= 0; i--) { const item = forecast[i]; ctx.lineTo(x(startIndex + i + 1), y(item.low)); }
    ctx.closePath(); ctx.fillStyle = 'rgba(221, 164, 86, .16)'; ctx.fill();
  }
  // Historical price line.
  ctx.beginPath();
  historical.forEach((item, i) => { if (i === 0) ctx.moveTo(x(i), y(item.price)); else ctx.lineTo(x(i), y(item.price)); });
  ctx.strokeStyle = '#4c8b60'; ctx.lineWidth = 2.3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.stroke();
  // Soft fill below history.
  ctx.lineTo(x(historical.length - 1), y(minY)); ctx.lineTo(x(0), y(minY)); ctx.closePath(); ctx.fillStyle = 'rgba(76,139,96,.055)'; ctx.fill();
  // Dashed forecast from last observed point.
  if (forecast.length) {
    ctx.beginPath(); ctx.moveTo(x(historical.length - 1), y(historical[historical.length - 1].price));
    forecast.forEach((item, i) => ctx.lineTo(x(historical.length + i), y(item.price)));
    ctx.strokeStyle = '#d29640'; ctx.lineWidth = 2.2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d29640'; ctx.lineWidth = 2;
    ctx.arc(x(historical.length + forecast.length - 1), y(forecast[forecast.length - 1].price), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const dividerX = x(historical.length - 1) + (forecast.length ? x(historical.length) - x(historical.length - 1) : 0) / 2;
    ctx.beginPath(); ctx.strokeStyle = '#d9dfd8'; ctx.setLineDash([3, 4]); ctx.moveTo(dividerX, top); ctx.lineTo(dividerX, top + plotH); ctx.stroke(); ctx.setLineDash([]);
  }
  // Date labels.
  const labels = [0, Math.round((total) * .25), Math.round(total * .5), Math.round(total * .75), total];
  ctx.fillStyle = '#96a097'; ctx.textAlign = 'center';
  labels.forEach(idx => {
    let date;
    if (idx < historical.length) date = historical[Math.min(idx, historical.length - 1)].date;
    else if (forecast.length) date = forecast[Math.min(idx - historical.length, forecast.length - 1)].date;
    if (date) ctx.fillText(displayDate(date, { month: 'short', year: '2-digit' }), x(idx), height - 13);
  });
}



function downloadCSV(filename, rows) {
  const csvCell = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportForecast() {
  if (!state.forecast.length) return showToast('Run a forecast first.');
  const rows = [['Date', 'Commodity', 'Market', 'Model', 'Predicted_Price_INR_Per_Quintal', 'Estimated_Low', 'Estimated_High', 'Change_From_Latest_Percent']];
  state.forecast.forEach(item => rows.push([item.date, $('#commoditySelect').value, $('#marketSelect').value, MODEL_NAMES[state.currentModel], item.price.toFixed(2), item.low.toFixed(2), item.high.toFixed(2), ((item.price - state.latestPrice) / state.latestPrice * 100).toFixed(2)]));
  downloadCSV('harvestiq-price-forecast.csv', rows);
}

function setUploadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') return showToast('Please choose a .csv file.');
  const maxSizeBytes = 25 * 1024 * 1024;
  if (file.size > maxSizeBytes) return showToast('CSV files must be 25 MB or smaller.');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const converted = convertRows(parseCSV(String(reader.result)));
      state.rows = converted.rows;
      state.datasetName = file.name;
      state.isDemo = false;
      populateSelectors(true);
      updateDatasetFacts();
      renderDashboard();
      showToast(`Imported ${number(state.rows.length)} valid rows${converted.skipped ? `; skipped ${converted.skipped} invalid rows` : ''}.`);
    } catch (error) {
      showToast(error.message || 'Could not read that CSV.');
    }
  };
  reader.onerror = () => showToast('The selected file could not be read.');
  reader.readAsText(file);
}

function initEvents() {
  $('#commoditySelect').addEventListener('change', () => {
    populateMarketSelector();
    renderDashboard();
  });
  ['#marketSelect', '#horizonSelect', '#modelSelect'].forEach(selector => {
    $(selector).addEventListener('change', renderDashboard);
  });
  $('#exportForecastBtn').addEventListener('click', exportForecast);
  $('#importTopBtn').addEventListener('click', () => $('#csvFileInput').click());
  $('#csvFileInput').addEventListener('change', event => { setUploadFile(event.target.files[0]); event.target.value = ''; });
  const dropZone = $('#dropZone');
  ['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', event => setUploadFile(event.dataTransfer.files[0]));
  $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => drawChart(state.series, state.forecast), 120); });
}

initEvents();
loadBundledDataset();
