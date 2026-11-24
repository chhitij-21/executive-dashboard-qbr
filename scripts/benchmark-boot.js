// scripts/benchmark-boot.js
// Measures cold boot latency from process invocation to active HTTP liveness probe (Item #1)

'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BENCHMARK_PORT = 3199;
const MAX_ALLOWED_BOOT_MS = 3500; // Cold start budget on local machine

async function pollHealthEndpoint(url, maxRetries = 50, intervalMs = 50) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(url, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });

      if (res.status === 200) {
        return res;
      }
    } catch (_) {
      // Server not ready yet; wait and retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server failed to respond with 200 on ${url} within timeout`);
}

async function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ITEM #1: COLD START LATENCY BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Starting server process on port ${BENCHMARK_PORT}...`);

  const startTime = Date.now();
  const env = {
    ...process.env,
    PORT: String(BENCHMARK_PORT),
    NODE_ENV: 'test',
    BENCHMARK_BOOT: 'true',
    LOG_LEVEL: 'silent',
  };

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'index.js')], {
    env,
    stdio: 'inherit',
  });

  const fs = require('fs');
  let killed = false;
  const cleanup = () => {
    if (!killed) {
      killed = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      try {
        if (child.pid) {
          const benchDb = path.join(__dirname, '..', 'data', `test-bench-${child.pid}.db`);
          if (fs.existsSync(benchDb)) fs.unlinkSync(benchDb);
          if (fs.existsSync(`${benchDb}-wal`)) fs.unlinkSync(`${benchDb}-wal`);
          if (fs.existsSync(`${benchDb}-shm`)) fs.unlinkSync(`${benchDb}-shm`);
        }
      } catch (_) {}
    }
  };

  try {
    const liveUrl = `http://127.0.0.1:${BENCHMARK_PORT}/health/live`;
    const res = await pollHealthEndpoint(liveUrl);
    const bootDuration = Date.now() - startTime;

    const body = JSON.parse(res.body);
    console.log(`✓ Server responsive on ${liveUrl}`);
    console.log(`  - Cold boot latency: ${bootDuration} ms`);
    console.log(`  - Memory RSS:        ${body.memoryMb?.rss} MB`);
    console.log(`  - Heap Used:         ${body.memoryMb?.heapUsed} MB`);
    console.log(`  - Target budget:     < ${MAX_ALLOWED_BOOT_MS} ms`);

    cleanup();

    if (bootDuration > MAX_ALLOWED_BOOT_MS) {
      console.error(`✖ REGRESSION: Cold boot time (${bootDuration}ms) exceeded budget (${MAX_ALLOWED_BOOT_MS}ms)`);
      process.exit(1);
    } else {
      console.log(`✓ Cold start optimization verified. Boot performance within budget.`);
      process.exit(0);
    }
  } catch (err) {
    cleanup();
    console.error(`✖ Benchmark error: ${err.message}`);
    process.exit(1);
  }
}

runBenchmark();
