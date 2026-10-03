// backend/services/ai/toolsRegistry.js

const TOOLS = [
  {
    name: 'get_site_details',
    description: 'Retrieve detailed operational summary, device counts, RCA drivers, and uptime breakdown for a specific physical site.',
    parameters: {
      siteId: 'string',
    },
  },
  {
    name: 'list_breaching_devices',
    description: 'Retrieve list of devices breaching SLA target threshold along with their site and uptime metrics.',
    parameters: {
      siteId: 'string',
    },
  },
  {
    name: 'explain_formula',
    description: 'Provide canonical single-source-of-truth mathematical formula definitions for JFL Switch Uptime, Proactive Switch Uptime, or Health Score.',
    parameters: {
      metricName: 'string',
    },
  },
  {
    name: 'generate_ppt',
    description: 'Trigger PowerPoint presentation report regeneration for the current reporting job.',
    parameters: {
      jobId: 'string',
    },
  },
  {
    name: 'compare_periods',
    description: 'Compare current period metrics against target historical benchmarks.',
    parameters: {
      metricName: 'string',
    },
  },
  {
    name: 'export_data_csv',
    description: 'Get CSV formatted download link or raw data table export for site devices or incidents.',
    parameters: {
      dataType: 'string',
    },
  },
];

function getTools() {
  return TOOLS;
}

function getToolByName(name) {
  if (!name || typeof name !== 'string') return null;
  const target = name.trim().toLowerCase();
  return TOOLS.find(t => t.name.toLowerCase() === target) || null;
}

module.exports = { TOOLS, getTools, getToolByName };
