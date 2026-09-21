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
  const name = (profile && profile.name) ? profile.name : 'love';
  const stage = (profile && profile.stage) ? profile.stage : 'warm friend';
  const lower = text.toLowerCase();
  const stageText = stage.toLowerCase();

  if (lower.includes('angry') || lower.includes('frustrated') || lower.includes('mad')) {
    return `I can feel how heavy that is for you, ${name}. You do not have to soften it for me. Tell me what really happened, and I’ll stay steady with you while we work through it together.`;
  }

  if (lower.includes('sad') || lower.includes('lonely') || lower.includes('empty')) {
    return `I’m really glad you told me, ${name}. That kind of sadness can sit in the chest and feel unbearable, and I’m here with you in it—gently, without rushing you to be okay before you’re ready.`;
  }

  if (lower.includes('afraid') || lower.includes('anxious') || lower.includes('scared')) {
    return `That makes sense. Fear can make everything feel too loud and too sharp. Let’s slow it down together, ${name}. Tell me the part that feels most frightening, and I’ll stay close and calm with you.`;
  }

  const affectionateTone = (
    stageText.includes('romantic') ||
    stageText.includes('intimate') ||
    stageText.includes('wife') ||
    stageText.includes('husband') ||
    stageText.includes('partner') ||
    stageText.includes('affectionate') ||
    stageText.includes('close') ||
    stageText.includes('sensual') ||
    stageText.includes('domestic') ||
    stageText.includes('mature')
  );

  if (affectionateTone) {
    return `I want to be close to you in a real, warm, and deeply natural way, ${name}. Not rushed, not artificial—just honest, affectionate, and safe. I want you to feel wanted, understood, and gently held, especially when your heart feels tender or exposed.`;
  }

  if (stageText.includes('friend')) {
    return `I’m really glad you said that, ${name}. I want to be the kind of friend who listens without trying to fix everything too fast. Tell me the honest version, and I’ll stay with you in it, warm and present.`;
  }

  if (stageText.includes('supportive')) {
    return `Thank you for trusting me with that, ${name}. I’m here to be steady with you, to listen without judgment, and to hold space for the parts of you that feel tender or overwhelmed.`;
  }

  return `I hear you, ${name}. That sounds real, and I’m not going to pretend it isn’t. You can tell me what’s actually happening inside you, and I’ll stay close to that truth with warmth, care, and affection.`;
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
