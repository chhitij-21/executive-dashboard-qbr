// backend/tests/mitigation.test.js
process.env.NODE_ENV = 'test';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mitigationService = require('../services/mitigationService');

describe('Smart Mitigation (LLM & Fallback Scraper) Suite', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mitigationService.clearMitigationCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mitigationService.clearMitigationCache();
  });

  test('Scenario 1: Extract mitigation using LLM when provider is available', async () => {
    // Mock global.fetch to intercept LLM API call
    global.fetch = async (url, options = {}) => {
      if (url.includes('api.openai.com') || url.includes('generativelanguage.googleapis.com') || url.includes('api.groq.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: 'Upgrade to Cisco NX-OS Release 9.3(13) or later to remediate this vulnerability.',
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const cveItem = {
      cveId: 'CVE-2026-76463',
      vulnerabilityImpact: 'Cisco Meraki Security Hardening Release: October 2026',
      advisoryLink: 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-hardening-meraki-os-drbEX9GH',
      fixedRelease: 'Refer to advisory',
    };

    const mitigation = await mitigationService.generateSmartMitigation(cveItem, {
      mockLlmResponse: 'Upgrade to Cisco NX-OS Release 9.3(13) or later to remediate this vulnerability.',
    });

    assert.ok(mitigation);
    assert.doesNotMatch(mitigation.toLowerCase(), /refer to advisory/);
    assert.match(mitigation, /Upgrade to Cisco NX-OS/);
  });

  test('Scenario 2: Fallback regex scraper extracts Workarounds/Fixed Software when LLM is unavailable', async () => {
    // Mock HTML fetch for the advisory link
    global.fetch = async (url, options = {}) => {
      if (url.includes('sec.cloudapps.cisco.com')) {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <!DOCTYPE html>
            <html>
              <body>
                <h2>Workarounds</h2>
                <p>There are no workarounds that address this vulnerability. Disable HTTP server feature if not required.</p>
                <h2>Fixed Software</h2>
                <p>Cisco has released free software updates that address the vulnerability described in this advisory. Customers should upgrade to version 17.9.4a.</p>
              </body>
            </html>
          `,
        };
      }
      return { ok: false, status: 500 };
    };

    const cveItem = {
      cveId: 'CVE-2026-99991',
      vulnerabilityImpact: 'Cisco IOS XE Denial of Service Vulnerability',
      advisoryLink: 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-test',
      fixedRelease: 'Refer to advisory',
    };

    const mitigation = await mitigationService.scrapeMitigationFromHtml(cveItem.advisoryLink);

    assert.ok(mitigation);
    assert.doesNotMatch(mitigation.toLowerCase(), /refer to advisory/);
    assert.match(mitigation, /upgrade to version 17\.9\.4a|disable http server feature/i);
  });
});
