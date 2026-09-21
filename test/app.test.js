const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'server.js');

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [appPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3456', RESET_DB: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start in time. Output: ${output}`));
    }, 10000);

    child.on('spawn', () => {
      setTimeout(() => {
        clearTimeout(timer);
        resolve(child);
      }, 500);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('all navigation targets resolve to accessible page sections', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const pageSections = [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map((match) => match[1]);
  const navigationTargets = [...html.matchAll(/showPage\('([^']+)'\)/g)].map((match) => match[1]);

  assert.ok(pageSections.length >= 6);
  for (const target of new Set(navigationTargets)) {
    assert.ok(pageSections.includes(target), `Missing page section for navigation target: ${target}`);
  }
});

test('server responds on health endpoint', async () => {
  const child = await startServer();
  try {
    const response = await fetch('http://127.0.0.1:3456/api/health');
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
  } finally {
    child.kill();
  }
});

test('chat endpoint accepts a session and stores a reply', async () => {
  const child = await startServer();
  try {
    const sessionResponse = await fetch('http://127.0.0.1:3456/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex', gender: 'Gentle Woman', stage: 'Comforting Confidant' })
    });
    const sessionData = await sessionResponse.json();
    assert.equal(sessionResponse.status, 200);
    assert.ok(sessionData.sessionId);

    const chatResponse = await fetch('http://127.0.0.1:3456/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionData.sessionId,
        profile: { name: 'Alex', gender: 'Gentle Woman', stage: 'Comforting Confidant' },
        text: 'I feel overwhelmed today.'
      })
    });
    const chatData = await chatResponse.json();
    assert.equal(chatResponse.status, 200);
    assert.ok(chatData.reply.length > 0);
  } finally {
    child.kill();
  }
});

test('signup and export endpoints work for account flows', async () => {
  const child = await startServer();
  try {
    const signupResponse = await fetch('http://127.0.0.1:3456/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Nina',
        email: 'nina@example.com',
        password: 'secret123',
        relationship: 'Warm friend with affectionate presence'
      })
    });
    const signupData = await signupResponse.json();
    assert.equal(signupResponse.status, 200);
    assert.ok(signupData.userId);
    assert.ok(signupData.authToken);

    const memoryResponse = await fetch('http://127.0.0.1:3456/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + signupData.authToken
      },
      body: JSON.stringify({
        userId: signupData.userId,
        profile: { name: 'Nina', stage: 'Warm friend with affectionate presence' },
        text: 'I miss you and I feel emotionally safe with you.'
      })
    });
    const memoryData = await memoryResponse.json();
    assert.equal(memoryResponse.status, 200);
    assert.ok(memoryData.reply.length > 0);

    const exportResponse = await fetch('http://127.0.0.1:3456/api/export?format=json&userId=' + signupData.userId + '&authToken=' + signupData.authToken);
    const exportData = await exportResponse.json();
    assert.equal(exportResponse.status, 200);
    assert.ok(Array.isArray(exportData.logs));

    const csvResponse = await fetch('http://127.0.0.1:3456/api/export?format=csv&userId=' + signupData.userId + '&authToken=' + signupData.authToken);
    assert.equal(csvResponse.status, 200);
    assert.match(await csvResponse.text(), /id,role,content,created_at,session_id,user_id/);

    const loginResponse = await fetch('http://127.0.0.1:3456/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nina@example.com', password: 'secret123' })
    });
    const loginData = await loginResponse.json();
    assert.equal(loginResponse.status, 200);
    assert.equal(loginData.userId, signupData.userId);
    assert.ok(loginData.authToken);

    const unauthorizedResponse = await fetch('http://127.0.0.1:3456/api/analytics?userId=' + signupData.userId);
    assert.equal(unauthorizedResponse.status, 401);
  } finally {
    child.kill();
  }
});
