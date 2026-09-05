const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Checking JavaScript syntax for all backend files...');

const backendDir = path.join(__dirname, '..', 'backend');
function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules') {
        results = results.concat(getJsFiles(fullPath));
      }
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  });
  return results;
}

const jsFiles = getJsFiles(backendDir);
let errors = 0;

jsFiles.forEach(file => {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    console.log(`[PASS] ${path.relative(path.join(__dirname, '..'), file)}`);
  } catch (err) {
    console.error(`[FAIL] ${path.relative(path.join(__dirname, '..'), file)}: ${err.stderr ? err.stderr.toString() : err.message}`);
    errors++;
  }
});

if (errors === 0) {
  console.log(`\n✅ Syntax check passed for all ${jsFiles.length} JavaScript backend files.`);
  process.exit(0);
} else {
  console.error(`\n❌ Syntax check failed for ${errors} file(s).`);
  process.exit(1);
}
