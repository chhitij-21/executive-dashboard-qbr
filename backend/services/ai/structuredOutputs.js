// backend/services/ai/structuredOutputs.js

function buildStructuredPrompt(baseContext) {
  const contextStr = String(baseContext || '');

  return `${contextStr}

SYSTEM INSTRUCTION FOR STRUCTURED JSON OUTPUT:
You MUST respond ONLY with a raw, valid JSON object matching the exact schema below. Do not include markdown codeblock fences (\`\`\`json), commentary, or leading/trailing text.

REQUIRED JSON SCHEMA:
{
  "summary": "Executive text summary of the answer",
  "chartData": {
    "type": "bar" | "line" | "pie",
    "labels": ["string"],
    "values": [number]
  } | null,
  "tableData": {
    "headers": ["string"],
    "rows": [["string"]]
  } | null,
  "actions": [
    {
      "label": "Action button label",
      "action": "API_ROUTE_OR_KEY"
    }
  ] | null
}`;
}

module.exports = { buildStructuredPrompt };
