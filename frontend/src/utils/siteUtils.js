// frontend/src/utils/siteUtils.js
// FINDING-025 FIX: Centralized site normalization utilities.
// Previously duplicated across App.jsx, SiteInspector.jsx, excelParser.js, processData.js
// with subtle differences. Single authoritative source for frontend use.

/**
 * Normalize a raw location string to a canonical site name.
 * Returns the normalized name (Title Case) or the original string if unrecognized.
 */
export function normalizeSiteName(site) {
  if (!site) return 'Unknown';
  const str = String(site).trim();
  const lower = str.toLowerCase();

  if (/blr|bangalore/i.test(lower)) return 'Bangalore';
  if (/g.*noida|gr.*noida|greater.*noida|grater.*noida|gnsc/i.test(lower)) return 'Greater Noida';
  if (/guwahati|gau/i.test(lower)) return 'Guwahati';
  if (/hyd|hyderabad/i.test(lower)) return 'Hyderabad';
  if (/mohali|moh/i.test(lower)) return 'Mohali';
  if (/mumbai|mumd|mumbai_dc/i.test(lower)) return 'Mumbai';
  if (/nagpur|nag/i.test(lower)) return 'Nagpur';
  if (/noida/i.test(lower)) return 'Noida';

  return str;
}

/** Lowercase normalized location for equality comparisons. */
export function normalizeLoc(loc) {
  if (!loc) return '';
  return normalizeSiteName(String(loc).trim()).toLowerCase();
}

const VALID_SITES_LOWER = [
  'bangalore', 'greater noida', 'guwahati', 'hyderabad',
  'mohali', 'mumbai', 'nagpur', 'noida',
];

const GENERIC_STRINGS = new Set([
  'unknown', 'sheet1', 'sheet 1', 'raw', 'jfl',
  'sla_compliance_report', 'sla compliance report',
  'all location', 'all locations', 'n/a', 'none', 'null',
]);

const GENERIC_PREFIXES = /^(raw|sheet|sla|jfl|incident)/i;
const GENERIC_SUBSTRINGS = /sla_compliance|sla compliance|july|august|september|report|compliance/i;

/**
 * Returns true if the location string is a generic/non-site value
 * (e.g. sheet name, SLA report name, 'All Locations', etc.)
 */
export function isGenericLocation(loc) {
  if (!loc) return true;
  const str = String(loc).trim().toLowerCase();
  if (GENERIC_STRINGS.has(str)) return true;
  if (GENERIC_PREFIXES.test(str)) return true;
  if (GENERIC_SUBSTRINGS.test(str)) return true;

  const norm = normalizeSiteName(str).toLowerCase();
  if (!VALID_SITES_LOWER.includes(norm)) return true;

  return false;
}
