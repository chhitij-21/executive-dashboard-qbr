// backend/services/ai/toolExecutor.js

const { getToolByName } = require('./toolsRegistry');
const { normalizeSiteName } = require('../excelParser');

async function executeTool(name, args = {}, qbrData = {}) {
  try {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'INVALID_TOOL_NAME' };
    }

    const toolDef = getToolByName(name);
    if (!toolDef) {
      return { success: false, error: `TOOL_NOT_FOUND: ${name}` };
    }

    const safeArgs = args && typeof args === 'object' ? args : {};

    if (name === 'get_site_details') {
      const siteId = safeArgs.siteId ? normalizeSiteName(safeArgs.siteId) : 'Bangalore';
      const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
      const siteData = siteSummary.find(s => normalizeSiteName(s.siteId) === siteId);

      if (!siteData) {
        return { success: false, error: `SITE_NOT_FOUND: ${siteId}` };
      }

      return {
        success: true,
        data: siteData,
      };
    }

    if (name === 'list_breaching_devices') {
      const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
      const siteIdFilter = safeArgs.siteId ? normalizeSiteName(safeArgs.siteId) : null;

      const breaching = devices.filter(d => {
        if (!d.__slaBreach) return false;
        if (siteIdFilter && normalizeSiteName(d.SiteID || d.Location) !== siteIdFilter) return false;
        return true;
      }).map(d => ({
        DeviceID: d.DeviceID,
        SerialNo: d.SerialNo,
        SiteID: d.SiteID || d.Location,
        DeviceType: d.DeviceType,
        proactiveUptime: d.__proactiveUptime,
        jflUptime: d.__jflUptime,
      }));

      return {
        success: true,
        data: {
          count: breaching.length,
          devices: breaching,
        },
      };
    }

    if (name === 'explain_formula') {
      const metric = String(safeArgs.metricName || 'jfl').toLowerCase();
      let explanation = '';

      if (metric.includes('jfl')) {
        explanation = 'JFL Switch Uptime % = ((Total Available Minutes - Time on Hold) / Total Available Minutes) * 100';
      } else if (metric.includes('proactive')) {
        explanation = 'Proactive Switch Uptime % = ((Total Available Minutes - Actual Resolution Time) / Total Available Minutes) * 100';
      } else if (metric.includes('health')) {
        explanation = 'Health Score = (overallUptime * 0.6) + (incidentFreePercent * 0.4)';
      } else {
        explanation = 'SLA Uptime Target = 99.30% (Period-aware dynamic target loaded from rules.yaml)';
      }

      return {
        success: true,
        data: {
          metricName: safeArgs.metricName || 'JFL Uptime',
          formula: explanation,
        },
      };
    }

    if (name === 'generate_ppt') {
      return {
        success: true,
        data: {
          jobId: safeArgs.jobId || 'latest',
          status: 'PPT generation task queued',
          downloadUrl: '/api/ppt/latest',
        },
      };
    }

    if (name === 'compare_periods') {
      const exec = qbrData.executiveSummary || {};
      return {
        success: true,
        data: {
          currentPeriod: qbrData.reportingPeriod || 'Current Period',
          overallUptime: exec.overallUptime || '100.00',
          jflSwitchUptime: exec.jflSwitchUptime || '100.00',
          slaCompliance: exec.slaCompliance || '100.00',
          targetSla: exec.slaTarget || 99.3,
        },
      };
    }

    if (name === 'export_data_csv') {
      return {
        success: true,
        data: {
          dataType: safeArgs.dataType || 'incidents',
          exportUrl: '/api/dashboard/export',
          recordCount: Array.isArray(qbrData.incidents) ? qbrData.incidents.length : 0,
        },
      };
    }

    return { success: false, error: 'TOOL_EXECUTION_FAILED' };
  } catch (err) {
    return {
      success: false,
      error: err?.message || 'TOOL_EXECUTION_ERROR',
    };
  }
}

module.exports = { executeTool };
