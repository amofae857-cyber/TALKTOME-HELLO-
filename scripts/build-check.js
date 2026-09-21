const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');

function assertFile(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required build file is missing: ${relativePath}`);
  }
}

function checkNodeFile(relativePath) {
  const result = spawnSync(process.execPath, ['--check', path.join(projectRoot, relativePath)], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

assertFile('server.js');
assertFile('public/index.html');
assertFile('vercel.json');
checkNodeFile('server.js');

const html = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
if (!html.includes('<main') || !html.includes('id="auth-page"')) {
  throw new Error('public/index.html does not contain the required application shell');
}

const vercelConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
if (!Array.isArray(vercelConfig.builds) || !vercelConfig.builds.some((build) => build.src === 'server.js')) {
  throw new Error('vercel.json must build server.js with @vercel/node');
}

console.log('Build checks passed: server, public app shell, and Vercel configuration.');