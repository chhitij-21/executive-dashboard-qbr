// backend/services/chartRenderer.js
// Server-side chart image rendering (OPTIONAL — requires chartjs-node-canvas).
// If not installed, all render functions return null and PPT uses text-only slides.
// To enable: npm install chartjs-node-canvas@4 chart.js@3 --legacy-peer-deps

let ChartJSNodeCanvas = null;
try {
  ({ ChartJSNodeCanvas } = require('chartjs-node-canvas'));
} catch (e) {
  console.warn('[chartRenderer] chartjs-node-canvas not installed — chart images in PPT disabled. Text data will be used instead.');
}

// If library not available, export stubs that return null
if (!ChartJSNodeCanvas) {
  module.exports = {
    renderBarChart: async () => null,
    renderDoughnutChart: async () => null,
    renderLineChart: async () => null,
    renderHorizontalBarChart: async () => null,
  };
  return; // CommonJS early exit
}


const WIDTH = 800;
const HEIGHT = 400;

// Dark-mode colour palette (mirrors index.css tokens)
const PALETTE = [
  'hsla(212,92%,52%,0.85)',
  'hsla(262,52%,62%,0.85)',
  'hsla(40,100%,55%,0.85)',
  'hsla(137,55%,45%,0.85)',
  'hsla(0,73%,58%,0.85)',
  'hsla(320,70%,60%,0.85)',
  'hsla(180,60%,50%,0.85)',
  'hsla(30,90%,55%,0.85)',
];

const BG_COLOR = '#0D1117';
const GRID_COLOR = '#21262D';
const TEXT_COLOR = '#8B949E';
const ACCENT = '#1F6FEB';

/**
 * Create a ChartJSNodeCanvas instance (lazy — module may not be installed yet).
 */
function getRenderer() {
  if (!ChartJSNodeCanvas) {
    throw new Error(
      'chartjs-node-canvas is not installed. Run: npm install chartjs-node-canvas'
    );
  }
  return new ChartJSNodeCanvas({
    width: WIDTH,
    height: HEIGHT,
    backgroundColour: BG_COLOR,
    chartCallback: (ChartJS) => {
      ChartJS.defaults.color = TEXT_COLOR;
      ChartJS.defaults.font.family = 'Arial, sans-serif';
    },
  });
}

const commonPlugins = {
  legend: { labels: { color: TEXT_COLOR, boxWidth: 14, padding: 16 } },
};

const commonScales = {
  x: { ticks: { color: TEXT_COLOR }, grid: { color: GRID_COLOR } },
  y: { ticks: { color: TEXT_COLOR }, grid: { color: GRID_COLOR } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bar Chart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a bar chart and return a PNG Buffer.
 * @param {string[]} labels
 * @param {{ label: string, data: number[], color?: string }[]} datasets
 * @param {object} extraOptions  merged into Chart.js options
 */
async function renderBarChart(labels, datasets, extraOptions = {}) {
  const renderer = getRenderer();
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.color || PALETTE[i % PALETTE.length],
        borderRadius: 4,
        borderSkipped: false,
      })),
    },
    options: {
      responsive: false,
      plugins: { ...commonPlugins, ...extraOptions.plugins },
      scales: mergeDeep(commonScales, extraOptions.scales || {}),
      ...extraOptions,
    },
  };
  return renderer.renderToBuffer(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Doughnut / Pie Chart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a doughnut chart and return a PNG Buffer.
 */
async function renderDoughnutChart(labels, data, extraOptions = {}) {
  const renderer = getRenderer();
  const config = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: PALETTE.slice(0, data.length),
        borderColor: BG_COLOR,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: false,
      plugins: { ...commonPlugins, ...extraOptions.plugins },
      ...extraOptions,
    },
  };
  return renderer.renderToBuffer(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Line Chart (trends)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a line chart and return a PNG Buffer.
 * @param {string[]} labels   x-axis labels (e.g. month names)
 * @param {{ label: string, data: number[], color?: string }[]} datasets
 */
async function renderLineChart(labels, datasets, extraOptions = {}) {
  const renderer = getRenderer();
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color || PALETTE[i % PALETTE.length],
        backgroundColor: (ds.color || PALETTE[i % PALETTE.length]).replace('0.85)', '0.15)'),
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: ds.color || PALETTE[i % PALETTE.length],
      })),
    },
    options: {
      responsive: false,
      plugins: { ...commonPlugins, ...extraOptions.plugins },
      scales: mergeDeep(commonScales, extraOptions.scales || {}),
      ...extraOptions,
    },
  };
  return renderer.renderToBuffer(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal Bar (for RCA / SLA breakdowns)
// ─────────────────────────────────────────────────────────────────────────────

async function renderHorizontalBarChart(labels, data, label = '', extraOptions = {}) {
  const renderer = getRenderer();
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: PALETTE.slice(0, data.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: false,
      plugins: { ...commonPlugins, legend: { display: false } },
      scales: mergeDeep(commonScales, extraOptions.scales || {}),
      ...extraOptions,
    },
  };
  return renderer.renderToBuffer(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────
function mergeDeep(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeDeep(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  renderBarChart,
  renderDoughnutChart,
  renderLineChart,
  renderHorizontalBarChart,
};
