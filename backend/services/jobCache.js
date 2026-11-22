// backend/services/jobCache.js
// In-memory active job cache for report generation tasks

'use strict';

const jobs = {};

function resetJobCache() {
  for (const k of Object.keys(jobs)) {
    if (k !== 'resetJobCache') {
      delete jobs[k];
    }
  }
}

jobs.resetJobCache = resetJobCache;

module.exports = jobs;
