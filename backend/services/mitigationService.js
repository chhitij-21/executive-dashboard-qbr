// backend/services/mitigationService.js
// Smart mitigation extractor using LLM (OpenAI, Gemini, Groq) with HTML regex scraper fallback.
// Caches extracted mitigations to avoid redundant network / LLM requests.

'use strict';

const fs = require('fs');
const path = require('path');

const MITIGATION_CACHE_FILE = path.resolve(__dirname, '../../data/mitigation_cache.json');
const memoryCache = new Map();

// Load persistent disk cache if available
function loadPersistentCache() {
  try {
    if (fs.existsSync(MITIGATION_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(MITIGATION_CACHE_FILE, 'utf-8'));
      if (typeof data === 'object' && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          memoryCache.set(k, v);
        }
      }
    }
  } catch (err) {
    // Non-blocking
  }
}

function savePersistentCache() {
  try {
    const dir = path.dirname(MITIGATION_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(memoryCache.entries());
    fs.writeFileSync(MITIGATION_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    // Non-blocking
  }
}

loadPersistentCache();

/**
 * Clears the cache (used in unit tests).
 */
function clearMitigationCache() {
  memoryCache.clear();
}

/**
 * Strips HTML tags and collapses whitespace.
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts 1-2 clean sentences from raw text.
 */
function extractSentences(text, maxSentences = 2) {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && !/^(table of contents|contents|introduction|back to top)/i.test(s));

  if (sentences.length === 0) return text.slice(0, 200).trim();
  return sentences.slice(0, maxSentences).join(' ');
}

/**
 * Scrapes mitigation instructions from Cisco security advisory HTML.
 * Looks for "Fixed Software" or "Workarounds" sections.
 */
async function scrapeMitigationFromHtml(advisoryLink) {
  if (!advisoryLink || typeof advisoryLink !== 'string') return null;

  const cacheKey = `scrape_${advisoryLink}`;
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  try {
    const res = await fetch(advisoryLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ExecutiveDashboard/1.0',
      },
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    let extracted = '';

    // Check for Cisco anchor <a name="fs"> or id="fixedsoftware" or "Fixed Software"
    const idxFsAnchor = html.search(/<a[^>]+name=['"]fs['"]/i);
    if (idxFsAnchor !== -1) {
      const rawFs = html.slice(idxFsAnchor, idxFsAnchor + 1500);
      const clean = stripHtml(rawFs).replace(/^Fixed\s+Software\s*/i, '').trim();
      extracted = extractSentences(clean, 2);
    }

    // Next check for general Fixed Software section
    if (!extracted || extracted.length < 15 || /refer to advisory/i.test(extracted)) {
      const fixedMatch = html.match(/(?:Fixed\s+Software|Fixed\s+Releases)[\s\S]{1,1200}?(?:<\/div>|<\/section>|<h[2-4]>|<\/body>|$)/i);
      if (fixedMatch) {
        const cleanFixed = stripHtml(fixedMatch[0])
          .replace(/^(?:Fixed Software|Fixed Releases)\s*/i, '')
          .trim();
        extracted = extractSentences(cleanFixed, 2);
      }
    }

    // Check for Workarounds section if Fixed Software wasn't found or was empty
    if (!extracted || extracted.length < 15 || /refer to advisory/i.test(extracted)) {
      const idxWa = html.search(/<a[^>]+name=['"]workarounds['"]/i);
      if (idxWa !== -1) {
        const rawWa = html.slice(idxWa, idxWa + 1500);
        const cleanWa = stripHtml(rawWa).replace(/^Workarounds\s*/i, '').trim();
        const sentences = extractSentences(cleanWa, 2);
        if (sentences && sentences.length > 15 && !/no workarounds/i.test(sentences)) {
          extracted = sentences;
        }
      }
    }

    if (!extracted || extracted.length < 15 || /refer to advisory/i.test(extracted)) {
      const workMatch = html.match(/(?:Workarounds)[\s\S]{1,1200}?(?:<\/div>|<\/section>|<h[2-4]>|<\/body>|$)/i);
      if (workMatch) {
        const cleanWork = stripHtml(workMatch[0])
          .replace(/^Workarounds\s*/i, '')
          .trim();
        const sentences = extractSentences(cleanWork, 2);
        if (sentences && sentences.length > 15 && !/no workarounds/i.test(sentences)) {
          extracted = sentences;
        }
      }
    }

    // Clean up if found
    if (extracted && extracted.length >= 10 && !/refer to advisory/i.test(extracted)) {
      memoryCache.set(cacheKey, extracted);
      savePersistentCache();
      return extracted;
    }
  } catch (err) {
    // Non-blocking fallback
  }

  return null;
}

/**
 * Call OpenAI API for single actionable mitigation.
 */
async function callOpenAI(prompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an enterprise network security specialist. Provide single-sentence actionable Cisco mitigations.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.2,
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  return content || null;
}

/**
 * Call Google Gemini API for single actionable mitigation.
 */
async function callGemini(prompt, apiKey) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 100, temperature: 0.2 },
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return content || null;
}

/**
 * Call Groq API for single actionable mitigation.
 */
async function callGroq(prompt, apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are an enterprise network security specialist. Provide single-sentence actionable Cisco mitigations.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.2,
    }),
  });

  if (!res.ok) return null;
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  return content || null;
}

/**
 * Generates an exact smart mitigation for a given CVE item.
 * Uses LLM if configured, else falls back to regex HTML scraper.
 *
 * @param {Object} cveItem
 * @param {Object} [options]
 * @returns {Promise<string>} Actionable mitigation text
 */
async function generateSmartMitigation(cveItem, options = {}) {
  const { cveId, vulnerabilityImpact, advisoryLink } = cveItem;
  const cacheKey = `cve_${cveId}`;

  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  // 1. Support test mock directly
  if (options.mockLlmResponse) {
    const resp = options.mockLlmResponse.trim();
    memoryCache.set(cacheKey, resp);
    savePersistentCache();
    return resp;
  }

  const prompt = `The following Cisco vulnerability needs an exact mitigation step.
CVE: ${cveId}
Title: ${vulnerabilityImpact}
Advisory Link: ${advisoryLink}
Provide a single actionable sentence (e.g., 'Upgrade to version X' or 'Disable feature Y'). Do not say 'Refer to advisory'.`;

  let llmMitigation = null;

  // Try configured LLMs in order
  try {
    if (process.env.OPENAI_API_KEY) {
      llmMitigation = await callOpenAI(prompt, process.env.OPENAI_API_KEY);
    } else if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      llmMitigation = await callGemini(prompt, process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    } else if (process.env.GROQ_API_KEY) {
      llmMitigation = await callGroq(prompt, process.env.GROQ_API_KEY);
    }
  } catch (err) {
    // Silently continue to fallback
  }

  if (llmMitigation && !/refer to advisory/i.test(llmMitigation)) {
    const cleaned = llmMitigation.replace(/^["']|["']$/g, '').trim();
    memoryCache.set(cacheKey, cleaned);
    savePersistentCache();
    return cleaned;
  }

  // 2. Fallback to HTML regex scraper
  const scraped = await scrapeMitigationFromHtml(advisoryLink);
  if (scraped && !/refer to advisory/i.test(scraped)) {
    memoryCache.set(cacheKey, scraped);
    savePersistentCache();
    return scraped;
  }

  // 3. Heuristic fallback based on product and title
  const title = (vulnerabilityImpact || '').toLowerCase();
  let fallback = 'Upgrade device firmware to the latest recommended release or apply vendor patch.';
  if (title.includes('meraki')) {
    fallback = 'Upgrade Cisco Meraki firmware to latest stable release.';
  } else if (title.includes('ios xe') || title.includes('catalyst')) {
    fallback = 'Upgrade Cisco IOS XE to current deferred/recommended release branch.';
  } else if (title.includes('nx-os') || title.includes('nexus')) {
    fallback = 'Upgrade Cisco NX-OS to recommended target release.';
  }

  memoryCache.set(cacheKey, fallback);
  savePersistentCache();
  return fallback;
}

/**
 * Enriches a list of CVEs with smart mitigations where fixedRelease is missing or says "Refer to advisory".
 *
 * @param {Array<Object>} cveList
 * @returns {Promise<Array<Object>>} Enriched list
 */
async function enrichVulnerabilitiesWithMitigation(cveList = []) {
  if (!Array.isArray(cveList)) return [];

  for (const item of cveList) {
    const currentFixed = (item.fixedRelease || '').trim();
    const needsMitigation = !currentFixed || /refer to advisory/i.test(currentFixed);

    if (needsMitigation) {
      if (!item.smartMitigation) {
        item.smartMitigation = await generateSmartMitigation(item);
      }
    } else {
      item.smartMitigation = currentFixed;
    }
  }

  return cveList;
}

module.exports = {
  generateSmartMitigation,
  scrapeMitigationFromHtml,
  enrichVulnerabilitiesWithMitigation,
  clearMitigationCache,
};
