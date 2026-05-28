require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'survey.db');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error(`Cannot create data dir ${DATA_DIR}:`, e.message);
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
db.exec(schema);

const ALLOWED_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'radio', 'checkbox', 'select', 'rating'];
const TYPES_WITH_OPTIONS = ['radio', 'checkbox', 'select'];

function ensureDefaultAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM admins').get();
  if (row.c === 0) {
    const u = process.env.ADMIN_USERNAME || 'admin';
    const p = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
      .run(u, bcrypt.hashSync(p, 10));
    console.log(`Default admin created: username="${u}"`);
  }
}
ensureDefaultAdmin();

const stmt = {
  insertSurvey: db.prepare(`INSERT INTO surveys (slug, title, description, fields_json, active)
    VALUES (@slug, @title, @description, @fields_json, @active)`),
  updateSurvey: db.prepare(`UPDATE surveys
    SET title=@title, description=@description, fields_json=@fields_json, active=@active, updated_at=datetime('now')
    WHERE id=@id`),
  getSurveyById: db.prepare('SELECT * FROM surveys WHERE id = ?'),
  getSurveyBySlug: db.prepare('SELECT * FROM surveys WHERE slug = ?'),
  getActiveSurveyBySlug: db.prepare('SELECT * FROM surveys WHERE slug = ? AND active = 1'),
  listSurveys: db.prepare('SELECT * FROM surveys ORDER BY id DESC'),
  deleteSurvey: db.prepare('DELETE FROM surveys WHERE id = ?'),
  countResponsesBySurvey: db.prepare('SELECT survey_id, COUNT(*) AS c FROM responses GROUP BY survey_id'),

  insertResponse: db.prepare(`INSERT INTO responses (survey_id, data_json, ip_address, user_agent)
    VALUES (@survey_id, @data_json, @ip_address, @user_agent)`),
  listResponses: db.prepare(`SELECT * FROM responses WHERE survey_id = ?
    ORDER BY id DESC LIMIT ? OFFSET ?`),
  countResponses: db.prepare('SELECT COUNT(*) AS c FROM responses WHERE survey_id = ?'),
  deleteResponse: db.prepare('DELETE FROM responses WHERE id = ?'),
  allResponses: db.prepare('SELECT * FROM responses WHERE survey_id = ? ORDER BY id DESC'),

  getAdmin: db.prepare('SELECT * FROM admins WHERE username = ?'),

  totalSurveys: db.prepare('SELECT COUNT(*) AS c FROM surveys'),
  activeSurveys: db.prepare('SELECT COUNT(*) AS c FROM surveys WHERE active = 1'),
  totalResponses: db.prepare('SELECT COUNT(*) AS c FROM responses'),
  todayResponses: db.prepare("SELECT COUNT(*) AS c FROM responses WHERE date(created_at) = date('now')"),
};

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^\w฀-๿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || crypto.randomBytes(4).toString('hex');
}

function uniqueSlug(base) {
  let s = base;
  let i = 1;
  while (stmt.getSurveyBySlug.get(s)) s = `${base}-${++i}`;
  return s;
}

function normalizeField(f, idx) {
  if (!f || typeof f !== 'object') throw new Error(`คำถามที่ ${idx + 1} ไม่ถูกต้อง`);
  const type = String(f.type || 'text');
  if (!ALLOWED_TYPES.includes(type)) throw new Error(`คำถามที่ ${idx + 1}: type "${type}" ไม่รองรับ`);
  const label = String(f.label || '').trim();
  if (!label) throw new Error(`คำถามที่ ${idx + 1}: ต้องมีหัวข้อ`);
  const key = String(f.key || '').trim() || `field_${idx + 1}`;
  if (!/^[a-zA-Z0-9_\-]+$/.test(key)) throw new Error(`คำถามที่ ${idx + 1}: key "${key}" ใช้ได้เฉพาะ a-z, 0-9, _, -`);

  const norm = { key, label, type, required: !!f.required };
  if (f.placeholder) norm.placeholder = String(f.placeholder);
  if (f.help) norm.help = String(f.help);
  if (TYPES_WITH_OPTIONS.includes(type)) {
    if (!Array.isArray(f.options) || f.options.length === 0) {
      throw new Error(`คำถามที่ ${idx + 1}: ${type} ต้องมีตัวเลือก`);
    }
    norm.options = f.options.map((o) => String(o));
  }
  if (type === 'rating') norm.max = Math.min(10, Math.max(2, parseInt(f.max) || 5));
  if (type === 'number') {
    if (f.min != null && f.min !== '') norm.min = Number(f.min);
    if (f.max != null && f.max !== '') norm.max = Number(f.max);
  }
  return norm;
}

function validateResponse(survey, payload) {
  const data = {};
  const errors = [];
  for (const field of survey.fields) {
    let val = payload[field.key];

    if (field.type === 'checkbox') {
      if (val == null) val = [];
      if (!Array.isArray(val)) val = [val];
      val = val.map((v) => String(v)).filter((v) => field.options.includes(v));
      if (field.required && val.length === 0) errors.push(`${field.label}: จำเป็น`);
      data[field.key] = val;
      continue;
    }

    if (val == null || val === '') {
      if (field.required) errors.push(`${field.label}: จำเป็น`);
      data[field.key] = null;
      continue;
    }

    val = String(val).trim();

    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      errors.push(`${field.label}: รูปแบบอีเมลไม่ถูกต้อง`);
    }
    if (field.type === 'tel' && !/^[0-9+\-\s()]{6,20}$/.test(val)) {
      errors.push(`${field.label}: เบอร์โทรไม่ถูกต้อง`);
    }
    if (field.type === 'number') {
      const n = Number(val);
      if (Number.isNaN(n)) errors.push(`${field.label}: ต้องเป็นตัวเลข`);
      else {
        if (field.min != null && n < field.min) errors.push(`${field.label}: ต้องไม่น้อยกว่า ${field.min}`);
        if (field.max != null && n > field.max) errors.push(`${field.label}: ต้องไม่เกิน ${field.max}`);
        val = n;
      }
    }
    if (field.type === 'rating') {
      const n = parseInt(val);
      if (Number.isNaN(n) || n < 1 || n > field.max) {
        errors.push(`${field.label}: คะแนนต้องอยู่ระหว่าง 1-${field.max}`);
      } else val = n;
    }
    if (['radio', 'select'].includes(field.type) && !field.options.includes(val)) {
      errors.push(`${field.label}: ตัวเลือกไม่ถูกต้อง`);
    }
    if (typeof val === 'string' && val.length > 5000) {
      errors.push(`${field.label}: ยาวเกินไป`);
    }

    data[field.key] = val;
  }
  return { data, errors };
}

function rowToSurvey(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    fields: JSON.parse(row.fields_json),
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToResponse(row) {
  return {
    id: row.id,
    survey_id: row.survey_id,
    data: JSON.parse(row.data_json),
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    created_at: row.created_at,
  };
}

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'ส่งข้อมูลบ่อยเกินไป กรุณาลองใหม่ภายหลัง' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'พยายาม login มากเกินไป กรุณารอ 15 นาที' },
});

function requireAuth(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'กรุณา login' });
    return res.redirect('/login.html');
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('admin_token');
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session หมดอายุ' });
    res.redirect('/login.html');
  }
}

// Public APIs

app.get('/api/surveys', (req, res) => {
  const counts = {};
  for (const r of stmt.countResponsesBySurvey.all()) counts[r.survey_id] = r.c;
  const rows = stmt.listSurveys.all().filter((r) => r.active);
  res.json({
    surveys: rows.map((r) => {
      const s = rowToSurvey(r);
      return {
        id: s.id, slug: s.slug, title: s.title, description: s.description,
        field_count: s.fields.length,
        response_count: counts[s.id] || 0,
      };
    }),
  });
});

app.get('/api/surveys/:slug', (req, res) => {
  const row = stmt.getActiveSurveyBySlug.get(req.params.slug);
  const survey = rowToSurvey(row);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });
  res.json({
    id: survey.id, slug: survey.slug, title: survey.title,
    description: survey.description, fields: survey.fields,
  });
});

app.post('/api/surveys/:slug/responses', submitLimiter, (req, res) => {
  try {
    const row = stmt.getActiveSurveyBySlug.get(req.params.slug);
    const survey = rowToSurvey(row);
    if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

    const { data, errors } = validateResponse(survey, req.body || {});
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', '), errors });

    const info = stmt.insertResponse.run({
      survey_id: survey.id,
      data_json: JSON.stringify(data),
      ip_address: req.ip || '',
      user_agent: req.get('user-agent') || '',
    });

    res.json({ success: true, id: info.lastInsertRowid, message: 'บันทึกข้อมูลเรียบร้อยแล้ว ขอบคุณ' });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด', detail: err.message });
  }
});

// Auth APIs

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอก username และ password' });

    const user = stmt.getAdmin.get(username);
    if (!user) return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, user: { username: user.username } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username } });
});

// Admin APIs

app.get('/api/admin/stats', requireAuth, (req, res) => {
  res.json({
    surveys: stmt.totalSurveys.get().c,
    active_surveys: stmt.activeSurveys.get().c,
    total_responses: stmt.totalResponses.get().c,
    today_responses: stmt.todayResponses.get().c,
  });
});

app.get('/api/admin/surveys', requireAuth, (req, res) => {
  const counts = {};
  for (const r of stmt.countResponsesBySurvey.all()) counts[r.survey_id] = r.c;
  const rows = stmt.listSurveys.all().map((r) => {
    const s = rowToSurvey(r);
    return {
      id: s.id, slug: s.slug, title: s.title, description: s.description,
      active: s.active,
      field_count: s.fields.length,
      response_count: counts[s.id] || 0,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });
  res.json({ surveys: rows });
});

app.get('/api/admin/surveys/:id', requireAuth, (req, res) => {
  const row = stmt.getSurveyById.get(req.params.id);
  const survey = rowToSurvey(row);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });
  res.json({ survey });
});

app.post('/api/admin/surveys', requireAuth, (req, res) => {
  try {
    const { title, slug, description, fields, active } = req.body;
    if (!title || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'ต้องมี title และ fields อย่างน้อย 1 ช่อง' });
    }

    const base = slugify(slug || title);
    const finalSlug = uniqueSlug(base);

    const normalized = fields.map((f, idx) => normalizeField(f, idx));
    const seen = new Set();
    for (const f of normalized) {
      if (seen.has(f.key)) return res.status(400).json({ error: `key ซ้ำ: ${f.key}` });
      seen.add(f.key);
    }

    const info = stmt.insertSurvey.run({
      slug: finalSlug,
      title: String(title).trim(),
      description: String(description || '').trim(),
      fields_json: JSON.stringify(normalized),
      active: active === false ? 0 : 1,
    });
    const survey = rowToSurvey(stmt.getSurveyById.get(info.lastInsertRowid));
    res.json({ success: true, survey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/surveys/:id', requireAuth, (req, res) => {
  try {
    const row = stmt.getSurveyById.get(req.params.id);
    const existing = rowToSurvey(row);
    if (!existing) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

    const { title, description, fields, active } = req.body;
    let nextFields = existing.fields;
    if (Array.isArray(fields)) {
      nextFields = fields.map((f, idx) => normalizeField(f, idx));
      const seen = new Set();
      for (const f of nextFields) {
        if (seen.has(f.key)) return res.status(400).json({ error: `key ซ้ำ: ${f.key}` });
        seen.add(f.key);
      }
    }

    stmt.updateSurvey.run({
      id: existing.id,
      title: title !== undefined ? String(title).trim() : existing.title,
      description: description !== undefined ? String(description || '').trim() : existing.description,
      fields_json: JSON.stringify(nextFields),
      active: typeof active === 'boolean' ? (active ? 1 : 0) : (existing.active ? 1 : 0),
    });
    const survey = rowToSurvey(stmt.getSurveyById.get(existing.id));
    res.json({ success: true, survey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/surveys/:id', requireAuth, (req, res) => {
  stmt.deleteSurvey.run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/surveys/:id/responses', requireAuth, (req, res) => {
  const row = stmt.getSurveyById.get(req.params.id);
  const survey = rowToSurvey(row);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const total = stmt.countResponses.get(survey.id).c;
  const rows = stmt.listResponses.all(survey.id, limit, offset).map(rowToResponse);

  res.json({
    survey: { id: survey.id, slug: survey.slug, title: survey.title, description: survey.description, fields: survey.fields },
    data: rows,
    page, total,
    pages: Math.ceil(total / limit) || 1,
  });
});

app.delete('/api/admin/responses/:id', requireAuth, (req, res) => {
  stmt.deleteResponse.run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/surveys/:id/export', requireAuth, (req, res) => {
  const row = stmt.getSurveyById.get(req.params.id);
  const survey = rowToSurvey(row);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

  const rows = stmt.allResponses.all(survey.id).map(rowToResponse);
  const headers = ['ID', ...survey.fields.map((f) => f.label), 'IP', 'วันที่ตอบ'];
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    const esc = s.replace(/"/g, '""');
    return /[",\n]/.test(esc) ? `"${esc}"` : esc;
  };

  const csv = [
    headers.map(escape).join(','),
    ...rows.map((r) => [
      r.id,
      ...survey.fields.map((f) => r.data?.[f.key]),
      r.ip_address || '',
      r.created_at || '',
    ].map(escape).join(',')),
  ].join('\n');

  const filename = `${survey.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
});

app.post('/api/admin/seed-demo', requireAuth, (req, res) => {
  try {
    const existing = stmt.getSurveyBySlug.get('demo-customer-satisfaction');
    if (existing) return res.status(400).json({ error: 'มีแบบสอบถามตัวอย่างอยู่แล้ว' });

    const fields = [
      { type: 'text', label: 'ชื่อ-นามสกุล', key: 'fullname', required: true, placeholder: 'กรอกชื่อ-นามสกุล' },
      { type: 'email', label: 'อีเมล', key: 'email', required: true },
      { type: 'tel', label: 'เบอร์โทร', key: 'phone', required: false },
      { type: 'select', label: 'ช่วงอายุ', key: 'age', required: true, options: ['ต่ำกว่า 20', '20-30', '31-40', '41-50', 'มากกว่า 50'] },
      { type: 'radio', label: 'เพศ', key: 'gender', required: false, options: ['ชาย', 'หญิง', 'ไม่ระบุ'] },
      { type: 'rating', label: 'คุณภาพสินค้า', key: 'q_quality', required: true, max: 5 },
      { type: 'rating', label: 'การบริการของพนักงาน', key: 'q_staff', required: true, max: 5 },
      { type: 'rating', label: 'ความรวดเร็ว', key: 'q_speed', required: true, max: 5 },
      { type: 'checkbox', label: 'ช่องทางที่รู้จักเรา', key: 'channels', required: false, options: ['Facebook', 'Instagram', 'TikTok', 'Google', 'เพื่อนแนะนำ', 'อื่นๆ'] },
      { type: 'radio', label: 'จะแนะนำให้คนอื่นใช้บริการหรือไม่', key: 'recommend', required: true, options: ['แน่นอน', 'อาจจะ', 'ไม่แน่ใจ', 'ไม่แนะนำ'] },
      { type: 'textarea', label: 'ข้อเสนอแนะเพิ่มเติม', key: 'comment', required: false, placeholder: 'กรอกความคิดเห็นของคุณ (ไม่บังคับ)' },
    ];
    const normalized = fields.map((f, idx) => normalizeField(f, idx));
    const info = stmt.insertSurvey.run({
      slug: 'demo-customer-satisfaction',
      title: 'แบบสอบถามความพึงพอใจลูกค้า',
      description: 'ขอบคุณที่ใช้บริการของเรา กรุณาสละเวลาเล็กน้อยเพื่อให้คะแนน',
      fields_json: JSON.stringify(normalized),
      active: 1,
    });
    const survey = rowToSurvey(stmt.getSurveyById.get(info.lastInsertRowid));
    res.json({ success: true, survey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Pages

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Health

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/health/db', (req, res) => {
  try {
    const r = stmt.totalResponses.get();
    res.json({
      status: 'connected',
      type: 'sqlite',
      path: DB_FILE,
      response_count: r.c,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`Survey Platform (SQLite) listening on :${PORT}`);
  console.log(`Public:    http://localhost:${PORT}/`);
  console.log(`Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`Database:  ${DB_FILE}`);
  console.log('========================================');
});

function shutdown() {
  console.log('Shutting down...');
  try { db.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
