// scripts/keep_alive.js
// Pings live Render endpoint every 10 minutes to prevent Render Free Tier container sleep.

const https = require('https');
const TARGET_URL = 'https://executive-dashboard-qbr-2.onrender.com/api/health';
const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function sendPing() {
  const timestamp = new Date().toISOString();
  https.get(TARGET_URL, (res) => {
    console.log(`[keep-alive] ${timestamp} GET ${TARGET_URL} → Status ${res.statusCode}`);
  }).on('error', (err) => {
    console.warn(`[keep-alive] ${timestamp} GET ${TARGET_URL} → Error: ${err.message}`);
  });
}

// Initial ping on start
console.log(`[keep-alive] Starting 10-minute keep-alive timer for ${TARGET_URL}...`);
sendPing();

// Recurring interval
setInterval(sendPing, PING_INTERVAL_MS);
