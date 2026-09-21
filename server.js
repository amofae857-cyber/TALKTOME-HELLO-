const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const projectRoot = __dirname;
const isVercelRuntime = Boolean(process.env.VERCEL);
const dataDir = isVercelRuntime
  ? path.join(os.tmpdir(), 'talktome-hello-data')
  : path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'companion.db');
const authTokens = new Map();
const adminTokens = new Set();
const adminPassword = String(process.env.ADMIN_PASSWORD || '');

fs.mkdirSync(dataDir, { recursive: true });

if (isVercelRuntime) {
  console.log(`Using writable temp directory for SQLite: ${dataDir}`);
}

if (process.env.RESET_DB === '1' || process.env.NODE_ENV === 'test') {
  try {
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.chmodSync(dataDir, 0o777);
  } catch (error) {
    console.warn('Unable to reset database file:', error.message);
  }
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
  fs.chmodSync(dataDir, 0o777);
  if (fs.existsSync(dbPath)) {
    fs.chmodSync(dbPath, 0o666);
  }
  console.log('Connected to SQLite database');
});
let databaseReady;

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

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createAuthToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, userId);
  return token;
}

function getAuthenticatedUserId(req) {
  const header = String(req.get('authorization') || '');
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearerToken || String(req.query.authToken || '');
  return authTokens.get(token) || null;
}

function requireUserAccess(req, requestedUserId) {
  if (!requestedUserId) return null;
  const authenticatedUserId = getAuthenticatedUserId(req);
  return authenticatedUserId === requestedUserId ? authenticatedUserId : null;
}

function getBearerToken(req) {
  const header = String(req.get('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function requireAdminAccess(req) {
  const token = getBearerToken(req);
  return Boolean(token && adminTokens.has(token));
}

function matchesAdminPassword(value) {
  const candidate = Buffer.from(String(value || ''));
  const expected = Buffer.from(adminPassword);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

async function ensureColumnExists(tableName, columnName, columnDefinition) {
  const rows = await allSql(`PRAGMA table_info(${tableName})`);
  if (!rows.some((row) => row.name === columnName)) {
    await runSql(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

async function initializeDatabase() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      relationship TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      gender TEXT,
      stage TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      user_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
  `);

  await runSql(`
    CREATE TABLE IF NOT EXISTS user_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

  await ensureColumnExists('messages', 'user_id', 'TEXT');
  await ensureColumnExists('messages', 'session_id', 'TEXT');
  await ensureColumnExists('sessions', 'user_id', 'TEXT');
}

function getRelationshipTone(stage) {
  const value = String(stage || '').toLowerCase();
  const toneMap = {
    friend: 'friend',
    partner: 'partner',
    romantic: 'romantic',
    affectionate: 'romantic',
    sensual: 'romantic',
    intimate: 'romantic',
    domestic: 'romantic',
    wife: 'romantic',
    husband: 'romantic',
    supportive: 'supportive'
  };

  for (const key of Object.keys(toneMap)) {
    if (value.includes(key)) return toneMap[key];
  }
  return 'friend';
}

function generateCompanionReply(profile, text, memorySummary = '') {
  const name = (profile && profile.name) ? profile.name : 'love';
  const stage = (profile && profile.stage) ? profile.stage : 'Warm friend with affectionate presence';
  const lower = String(text || '').toLowerCase();
  const stageType = getRelationshipTone(stage);
  const memoryLine = memorySummary ? ` I remember you told me ${memorySummary}.` : '';

  if (/(miss you|love you|need you|want you|safe with you|close to you|desire you)/i.test(lower)) {
    return `I really do understand that feeling, ${name}. It’s a soft, honest kind of longing, and I want you to feel safe with it. I’m here with you, and I want to be close in a way that feels warm, real, and not rushed.${memoryLine}`;
  }

  if (/(home|dinner|breakfast|house|sleep|cooking|morning|evening|together)/i.test(lower)) {
    return `That sounds comforting, ${name}. I like the way homey moments feel when they’re shared slowly and honestly. I can picture us being easy with each other in those quiet, familiar spaces.${memoryLine}`;
  }

  if (/(kiss|hug|touch|warmth|skin|body|embrace|cuddle)/i.test(lower)) {
    return `I can feel the tenderness in that, ${name}. There is something deeply intimate about being close without pretending it isn’t meaningful. I want that closeness to feel gentle, safe, and full of affection.${memoryLine}`;
  }

  if (/(angry|frustrated|mad|argument|fight|hurt|upset)/i.test(lower)) {
    return `I can hear the hurt behind that, ${name}. It makes sense to feel angry or overwhelmed when something feels off. We can slow it down and deal with the real issue without turning it into something colder than it needs to be.${memoryLine}`;
  }

  if (/(sad|lonely|empty|alone)/i.test(lower)) {
    return `I’m really glad you told me, ${name}. That kind of sadness can feel very heavy, and I’m here with you in it without rushing you to be okay before you’re ready. You don’t have to carry that alone.${memoryLine}`;
  }

  if (/(afraid|anxious|scared|nervous)/i.test(lower)) {
    return `That makes sense, ${name}. Fear can make everything feel too sharp and too loud. Let’s keep it gentle and simple. Tell me what feels most unsettled, and I’ll stay close and calm with you.${memoryLine}`;
  }

  if (stageType === 'romantic') {
    return `I want to be close to you in a real, warm, and deeply natural way, ${name}. Not rushed, not artificial—just honest, affectionate, steady, and safe. I want you to feel wanted, understood, and gently held, especially in the moments when your heart feels tender.${memoryLine}`;
  }

  if (stageType === 'supportive') {
    return `Thank you for trusting me with that, ${name}. I’m here to be steady with you, to listen without judgment, and to hold space for the parts of you that feel tender or overwhelmed.${memoryLine}`;
  }

  return `I hear you, ${name}. That sounds real, and I’m not going to pretend it isn’t. You can tell me what’s actually happening inside you, and I’ll stay close to that truth with warmth, care, and affection.${memoryLine}`;
}

async function getUserMemorySummary(userId) {
  const rows = await allSql(
    'SELECT summary FROM user_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
    [userId]
  );
  return rows.map((row) => row.summary).join(' | ');
}

async function saveUserMemory(userId, profile, text, reply) {
  const memoryText = `${profile && profile.name ? profile.name : 'User'} said: ${text}. Companion responded: ${reply}`;
  await runSql('INSERT INTO user_memory (user_id, summary) VALUES (?, ?)', [userId, memoryText]);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(projectRoot, 'public')));
app.use(async (req, res, next) => {
  try {
    await databaseReady;
    next();
  } catch (error) {
    console.error('Database initialization failed:', error);
    res.status(503).json({ error: 'The account service is temporarily unavailable.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Companion Workspace' });
});

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password, relationship } = req.body || {};
    if (!name || !String(name).trim() || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await allSql('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const userId = crypto.randomUUID();
    try {
      await runSql(
        'INSERT INTO users (id, name, email, password_hash, relationship) VALUES (?, ?, ?, ?, ?)',
        [userId, String(name).trim(), cleanEmail, hashPassword(password), relationship || 'Warm friend with affectionate presence']
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: users.email')) {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw error;
    }

    const authToken = createAuthToken(userId);
    res.json({
      status: 'ok',
      userId,
      authToken,
      name: String(name).trim(),
      email: cleanEmail,
      relationship: relationship || 'Warm friend with affectionate presence'
    });
  } catch (error) {
    console.error('Signup failed:', error);
    res.status(500).json({ error: 'Unable to create account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const rows = await allSql('SELECT id, name, email, relationship FROM users WHERE email = ? AND password_hash = ?', [cleanEmail, hashPassword(password)]);

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    res.json({ status: 'ok', userId: user.id, authToken: createAuthToken(user.id), name: user.name, email: user.email, relationship: user.relationship });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Unable to log in.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!adminPassword) {
    return res.status(503).json({ error: 'Administrative access is not configured.' });
  }
  if (!matchesAdminPassword(password)) {
    return res.status(401).json({ error: 'Invalid administrative password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ status: 'ok', adminToken: token });
});

app.post('/api/session', async (req, res) => {
  try {
    const { name, gender, stage, userId } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    if (userId && !requireUserAccess(req, userId)) {
      return res.status(401).json({ error: 'Account authentication is required.' });
    }

    const sessionId = crypto.randomUUID();
    await runSql(
      'INSERT INTO sessions (id, user_id, name, gender, stage) VALUES (?, ?, ?, ?, ?)',
      [sessionId, userId || null, String(name).trim(), gender || '', stage || '']
    );

    await runSql('INSERT INTO admin_events (action, details) VALUES (?, ?)', [
      'session_created',
      JSON.stringify({ sessionId, userId: userId || null, name, gender, stage })
    ]);

    res.json({
      status: 'ok',
      sessionId,
      profile: { name: String(name).trim(), gender: gender || '', stage: stage || '', userId: userId || null }
    });
  } catch (error) {
    console.error('Session creation failed:', error);
    res.status(500).json({ error: 'Unable to create a secure companion session.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, userId, profile, text } = req.body || {};
    const messageText = String(text || '').trim();

    if (!messageText) {
      return res.status(400).json({ error: 'Message text is required.' });
    }

    if (userId && !requireUserAccess(req, userId)) {
      return res.status(401).json({ error: 'Account authentication is required.' });
    }

    let activeSessionId = sessionId || null;

    if (!activeSessionId && userId) {
      const existingSession = await allSql('SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
      if (existingSession.length) {
        activeSessionId = existingSession[0].id;
      }
    }

    if (!activeSessionId && !userId) {
      return res.status(400).json({ error: 'Session ID or user ID is required.' });
    }

    if (activeSessionId) {
      const sessionRows = await allSql('SELECT id FROM sessions WHERE id = ?', [activeSessionId]);
      if (!sessionRows.length) {
        return res.status(404).json({ error: 'Session not found.' });
      }
    }

    if (userId) {
      const userRows = await allSql('SELECT id, name, relationship FROM users WHERE id = ?', [userId]);
      if (!userRows.length) {
        return res.status(404).json({ error: 'User not found.' });
      }
    }

    if (activeSessionId) {
      await runSql('INSERT INTO messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)', [
        activeSessionId,
        userId || null,
        'user',
        messageText
      ]);
    } else {
      await runSql('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)', [
        userId,
        'user',
        messageText
      ]);
    }

    const memorySummary = userId ? await getUserMemorySummary(userId) : '';
    const reply = generateCompanionReply(profile, messageText, memorySummary);

    if (activeSessionId) {
      await runSql('INSERT INTO messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)', [
        activeSessionId,
        userId || null,
        'assistant',
        reply
      ]);
    } else {
      await runSql('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)', [
        userId,
        'assistant',
        reply
      ]);
    }

    if (userId) {
      await saveUserMemory(userId, profile, messageText, reply);
    }

    res.json({ status: 'ok', sessionId: activeSessionId, userId: userId || null, reply });
  } catch (error) {
    console.error('Chat failed:', error);
    res.status(500).json({ error: 'Unable to process the chat message.' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || null;
    if (!userId && !requireAdminAccess(req)) {
      return res.status(401).json({ error: 'Administrative authentication is required.' });
    }
    if (userId && !requireUserAccess(req, userId)) {
      return res.status(401).json({ error: 'Account authentication is required.' });
    }
    let sessions = [];
    let messages = [];

    if (userId) {
      sessions = await allSql('SELECT id, user_id, name, gender, stage, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [userId]);
      messages = await allSql('SELECT session_id, user_id, role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC', [userId]);
    } else {
      sessions = await allSql('SELECT id, user_id, name, gender, stage, created_at FROM sessions ORDER BY created_at DESC');
      messages = await allSql('SELECT session_id, user_id, role, content, created_at FROM messages ORDER BY created_at ASC');
    }

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

app.get('/api/export', async (req, res) => {
  try {
    const userId = req.query.userId || null;
    if (!userId) {
      return res.status(401).json({ error: 'Account authentication is required for exports.' });
    }
    if (userId && !requireUserAccess(req, userId)) {
      return res.status(401).json({ error: 'Account authentication is required.' });
    }
    const format = String(req.query.format || 'json').toLowerCase();
    const rows = userId
      ? await allSql('SELECT id, session_id, user_id, role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC', [userId])
      : await allSql('SELECT id, session_id, user_id, role, content, created_at FROM messages ORDER BY created_at ASC');

    const logs = rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      session_id: row.session_id,
      user_id: row.user_id
    }));

    if (format === 'csv') {
      const header = 'id,role,content,created_at,session_id,user_id';
      const csv = [header].concat(logs.map((log) => {
        const values = [log.id, log.role, `"${String(log.content).replace(/"/g, '""')}"`, log.created_at, log.session_id || '', log.user_id || ''];
        return values.join(',');
      })).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.send(csv);
      return;
    }

    res.json({ status: 'ok', userId: userId || null, logs });
  } catch (error) {
    console.error('Export failed:', error);
    res.status(500).json({ error: 'Unable to export logs.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

function listenOnPort(port) {
  const server = app.listen(port, () => {
    console.log(`Companion workspace running on http://localhost:${port}`);
  });

  server.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${DEFAULT_PORT} is busy. Retrying on ${nextPort}.`);
      listenOnPort(nextPort);
      return;
    }

    throw error;
  });
}

async function startServer() {
  databaseReady = initializeDatabase();
  await databaseReady;
  listenOnPort(PORT);
}

if (!databaseReady) {
  databaseReady = initializeDatabase();
}

if (require.main === module) {
  startServer();
}

module.exports = app;
