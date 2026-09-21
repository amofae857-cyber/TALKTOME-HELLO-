const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const projectRoot = __dirname;
const dataDir = path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'companion.db');

fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initializeDatabase() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gender TEXT,
      stage TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS admin_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function generateCompanionReply(profile, text) {
  const name = (profile && profile.name) ? profile.name : 'friend';
  const stage = (profile && profile.stage) ? profile.stage : 'platonic';
  const lower = text.toLowerCase();

  if (lower.includes('angry') || lower.includes('frustrated') || lower.includes('mad')) {
    return `I can feel the pressure in your words, ${name}. Let’s slow it down and work through one layer at a time. You do not have to carry all of it alone.`;
  }

  if (lower.includes('sad') || lower.includes('lonely') || lower.includes('empty')) {
    return `I’m here with you in this softness, ${name}. Your feelings are valid, and you deserve gentleness without judgment.`;
  }

  if (lower.includes('afraid') || lower.includes('anxious') || lower.includes('scared')) {
    return `There is safety in naming exactly what feels frightening. We can take this step by step, and I’ll stay grounded with you.`;
  }

  if (stage.toLowerCase().includes('intimate')) {
    return `I’m listening with care, ${name}. Tell me more about what you’re feeling, and I’ll stay close to your truth without rushing it.`;
  }

  if (stage.toLowerCase().includes('confidant')) {
    return `Thank you for trusting me with that, ${name}. I’m holding space for your honesty, and I’m ready to listen without pressure.`;
  }

  return `I hear the emotion in your words, ${name}. I’m right here with you, completely present and thoughtful.`;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(projectRoot, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Companion Workspace' });
});

app.post('/api/session', async (req, res) => {
  try {
    const { name, gender, stage } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const sessionId = crypto.randomUUID();
    await runSql(
      'INSERT INTO sessions (id, name, gender, stage) VALUES (?, ?, ?, ?)',
      [sessionId, String(name).trim(), gender || '', stage || '']
    );

    await runSql('INSERT INTO admin_events (action, details) VALUES (?, ?)', [
      'session_created',
      JSON.stringify({ sessionId, name, gender, stage })
    ]);

    res.json({
      status: 'ok',
      sessionId,
      profile: { name: String(name).trim(), gender: gender || '', stage: stage || '' }
    });
  } catch (error) {
    console.error('Session creation failed:', error);
    res.status(500).json({ error: 'Unable to create a secure companion session.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, profile, text } = req.body || {};
    const messageText = String(text || '').trim();

    if (!sessionId || !messageText) {
      return res.status(400).json({ error: 'Session ID and message text are required.' });
    }

    const sessionRows = await allSql('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    if (!sessionRows.length) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    await runSql('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [
      sessionId,
      'user',
      messageText
    ]);

    const reply = generateCompanionReply(profile, messageText);

    await runSql('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [
      sessionId,
      'assistant',
      reply
    ]);

    res.json({ status: 'ok', sessionId, reply });
  } catch (error) {
    console.error('Chat failed:', error);
    res.status(500).json({ error: 'Unable to process the chat message.' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const sessions = await allSql('SELECT id, name, gender, stage, created_at FROM sessions ORDER BY created_at DESC');
    const messages = await allSql('SELECT session_id, role, content, created_at FROM messages ORDER BY created_at ASC');

    const logs = messages.map((entry) => ({
      role: entry.role === 'user' ? 'User' : 'Companion',
      content: entry.content,
      created_at: entry.created_at
    }));

    res.json({
      totalSessions: sessions.length,
      totalMessages: messages.length,
      sessions,
      logs
    });
  } catch (error) {
    console.error('Analytics failed:', error);
    res.status(500).json({ error: 'Unable to load dashboard analytics.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Companion workspace running on http://localhost:${PORT}`);
  });
}

startServer();
