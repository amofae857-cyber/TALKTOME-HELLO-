const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'server.js');

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [appPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3456' },
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
