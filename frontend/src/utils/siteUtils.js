// frontend/src/utils/siteUtils.js
// Centralized site normalization utilities supporting all registered customers.
// Authoritative source for frontend site name normalization and generic location detection.

/**
 * Normalize a raw location string to a canonical site name.
 * Supports JFL and MMTC sites. Returns Title Case canonical name or original string.
 */
export function normalizeSiteName(site) {
  if (!site) return 'Unknown';
  const str = String(site).trim();
  const lower = str.toLowerCase();

  // MMTC Sites
  if (/ggn[\s_-]?plant|gurgaon[\s_-]?plant/i.test(lower)) return 'Gurgaon Plant';
  if (/ggn[\s_-]?(head[\s_-]?office|ho)|gurgaon[\s_-]?(head[\s_-]?office|ho)|sec70/i.test(lower)) return 'Gurgaon Head Office';
  if (/bhubaneswar|bhbaneshwar|bbsr/i.test(lower)) return 'Bhubaneswar';
  if (/okhla/i.test(lower)) return 'Okhla';
  if (/vijaywada|vijayawada/i.test(lower)) return 'Vijaywada';
  if (/vizag|visakhapatnam/i.test(lower)) return 'Vizag';
  if (/lajpat/i.test(lower)) return 'Lajpat Nagar';
  if (/thrissur|trichur/i.test(lower)) return 'Thrissur';
  if (/ludhiana/i.test(lower)) return 'Ludhiana';
  if (/chennai|madras/i.test(lower)) return 'Chennai';
  if (/karol[\s_-]?bagh/i.test(lower)) return 'Karolbagh';
  if (/kolkata|calcutta/i.test(lower)) return 'Kolkata';
  if (/ahmedabad/i.test(lower)) return 'Ahmedabad';
  if (/coimbatore/i.test(lower)) return 'Coimbatore';
  if (/pune/i.test(lower)) return 'Pune';
  if (/rohini/i.test(lower)) return 'Rohini Delhi';

  // JFL & Standard Sites
  if (/blr|bangalore/i.test(lower)) return 'Bangalore';
  if (/g(r|reater)[\s._-]?noida|\bgnsc\b|\bgnmc\b/i.test(lower)) return 'Greater Noida';
  if (/guwahati|gau/i.test(lower)) return 'Guwahati';
  if (/hyd|hyderabad/i.test(lower)) return 'Hyderabad';
  if (/mohali|moh/i.test(lower)) return 'Mohali';
  if (/mumbai[\s_-]?dc|mumd[\s_-]?dc/i.test(lower)) return 'Mumbai-DC';
  if (/mumbai|mumd/i.test(lower)) return 'Mumbai';
  if (/nagpur|nag/i.test(lower)) return 'Nagpur';
  if (/noida/i.test(lower)) return 'Noida';

  return str;
}

/** Lowercase normalized location for equality comparisons. */
export function normalizeLoc(loc) {
  if (!loc) return '';
  return normalizeSiteName(String(loc).trim()).toLowerCase();
}

const GENERIC_STRINGS = new Set([
  '', 'unknown', 'sheet1', 'sheet 1', 'raw', 'jfl',
  'sla_compliance_report', 'sla compliance report',
  'all location', 'all locations', 'n/a', 'none', 'null', '-', '—',
]);

const GENERIC_PREFIXES = /^(raw|sheet|sla|jfl|incident)/i;
const GENERIC_SUBSTRINGS = /sla_compliance|sla compliance|july|august|september|october|november|december|january|february|march|april|may|june|report|compliance|inventory india/i;

/**
 * Returns true if the location string is a generic/non-site placeholder
 * (e.g. sheet name, SLA report name, 'All Locations', 'Unknown', etc.)
 * Does NOT filter out valid customer site names.
 */
export function isGenericLocation(loc) {
  if (!loc || typeof loc !== 'string') return true;
  const str = String(loc).trim().toLowerCase();
  if (GENERIC_STRINGS.has(str)) return true;
  if (/^(all\s*(locations?|sites?)?|overall|entire\s*network)$/i.test(str)) return true;
  if (GENERIC_PREFIXES.test(str)) return true;
  if (GENERIC_SUBSTRINGS.test(str)) return true;
  return false;
}
