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

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'survey-platform.json');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error(`Cannot create data dir ${DATA_DIR}:`, e.message);
}

const initialState = {
  nextSurveyId: 1,
  nextResponseId: 1,
  surveys: [],
  responses: [],
  admins: [],
};

let state = initialState;

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      state = { ...initialState, ...JSON.parse(raw) };
      console.log(`Loaded: ${state.surveys.length} surveys, ${state.responses.length} responses`);
    } else {
      saveStateSync();
    }
  } catch (err) {
    console.error('Failed to load data:', err.message);
    state = { ...initialState };
  }
}

let saveQueued = false;
function saveState() {
  if (saveQueued) return;
  saveQueued = true;
  setImmediate(() => {
    saveStateSync();
    saveQueued = false;
  });
}

function saveStateSync() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Save error:', err.message);
  }
}

loadState();

if (state.admins.length === 0) {
  const u = process.env.ADMIN_USERNAME || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'admin123';
  state.admins.push({
    id: 1,
    username: u,
    password_hash: bcrypt.hashSync(p, 10),
    created_at: new Date().toISOString(),
  });
  saveStateSync();
  console.log(`Default admin: username="${u}"`);
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
    return res.redirect('/admin/login');
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('admin_token');
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session หมดอายุ' });
    res.redirect('/admin/login');
  }
}

const ALLOWED_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'radio', 'checkbox', 'select', 'rating'];

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^\w฀-๿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || crypto.randomBytes(4).toString('hex');
}

function normalizeField(f, idx) {
  if (!f || typeof f !== 'object') throw new Error(`field ${idx} ไม่ถูกต้อง`);
  const type = String(f.type || 'text');
  if (!ALLOWED_TYPES.includes(type)) throw new Error(`field ${idx}: type "${type}" ไม่รองรับ`);
  const label = String(f.label || '').trim();
  if (!label) throw new Error(`field ${idx}: ต้องมี label`);
  const key = String(f.key || '').trim() || `field_${idx + 1}`;
  if (!/^[a-zA-Z0-9_\-]+$/.test(key)) throw new Error(`field ${idx}: key "${key}" ใช้ได้เฉพาะ a-z, 0-9, _, -`);

  const norm = {
    key,
    label,
    type,
    required: !!f.required,
  };
  if (f.placeholder) norm.placeholder = String(f.placeholder);
  if (f.help) norm.help = String(f.help);
  if (['radio', 'checkbox', 'select'].includes(type)) {
    if (!Array.isArray(f.options) || f.options.length === 0) {
      throw new Error(`field ${idx}: type ${type} ต้องมี options`);
    }
    norm.options = f.options.map((o) => String(o));
  }
  if (type === 'rating') {
    norm.max = Math.min(10, Math.max(2, parseInt(f.max) || 5));
  }
  if (type === 'number') {
    if (f.min != null) norm.min = Number(f.min);
    if (f.max != null) norm.max = Number(f.max);
  }
  return norm;
}

function validateResponse(survey, payload) {
  const data = {};
  const errors = [];
  const seen = new Set();
  for (const field of survey.fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
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

app.get('/api/surveys/:slug', (req, res) => {
  const survey = state.surveys.find((s) => s.slug === req.params.slug && s.active);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });
  res.json({
    id: survey.id,
    slug: survey.slug,
    title: survey.title,
    description: survey.description || '',
    fields: survey.fields,
  });
});

app.post('/api/surveys/:slug/responses', submitLimiter, (req, res) => {
  try {
    const survey = state.surveys.find((s) => s.slug === req.params.slug && s.active);
    if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

    const { data, errors } = validateResponse(survey, req.body || {});
    if (errors.length > 0) return res.status(400).json({ error: errors.join(', '), errors });

    const record = {
      id: state.nextResponseId++,
      survey_id: survey.id,
      survey_slug: survey.slug,
      data,
      ip_address: req.ip || '',
      user_agent: req.get('user-agent') || '',
      created_at: new Date().toISOString(),
    };
    state.responses.push(record);
    saveState();

    res.json({ success: true, id: record.id, message: 'บันทึกข้อมูลเรียบร้อยแล้ว ขอบคุณ' });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด', detail: err.message });
  }
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอก username และ password' });

    const user = state.admins.find((a) => a.username === username);
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
    res.json({ success: true });
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

app.get('/api/admin/surveys', requireAuth, (req, res) => {
  const list = state.surveys.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description || '',
    active: s.active,
    field_count: s.fields.length,
    response_count: state.responses.filter((r) => r.survey_id === s.id).length,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
  res.json({ surveys: list });
});

app.get('/api/admin/surveys/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const survey = state.surveys.find((s) => s.id === id);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });
  res.json({ survey });
});

app.post('/api/admin/surveys', requireAuth, (req, res) => {
  try {
    const { title, slug, description, fields, active } = req.body;
    if (!title || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: 'ต้องมี title และ fields อย่างน้อย 1 ช่อง' });
    }

    let finalSlug = slug ? slugify(slug) : slugify(title);
    let attempt = finalSlug;
    let i = 1;
    while (state.surveys.some((s) => s.slug === attempt)) {
      attempt = `${finalSlug}-${++i}`;
    }
    finalSlug = attempt;

    const normalizedFields = fields.map((f, idx) => normalizeField(f, idx));
    const keys = new Set();
    for (const f of normalizedFields) {
      if (keys.has(f.key)) return res.status(400).json({ error: `key ซ้ำ: ${f.key}` });
      keys.add(f.key);
    }

    const now = new Date().toISOString();
    const survey = {
      id: state.nextSurveyId++,
      slug: finalSlug,
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      fields: normalizedFields,
      active: active !== false,
      created_at: now,
      updated_at: now,
    };
    state.surveys.push(survey);
    saveState();
    res.json({ success: true, survey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/surveys/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const survey = state.surveys.find((s) => s.id === id);
    if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

    const { title, description, fields, active } = req.body;
    if (title) survey.title = String(title).trim();
    if (description !== undefined) survey.description = String(description || '').trim();
    if (typeof active === 'boolean') survey.active = active;
    if (Array.isArray(fields)) {
      const normalized = fields.map((f, idx) => normalizeField(f, idx));
      const keys = new Set();
      for (const f of normalized) {
        if (keys.has(f.key)) return res.status(400).json({ error: `key ซ้ำ: ${f.key}` });
        keys.add(f.key);
      }
      survey.fields = normalized;
    }
    survey.updated_at = new Date().toISOString();
    saveState();
    res.json({ success: true, survey });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/surveys/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const before = state.surveys.length;
  state.surveys = state.surveys.filter((s) => s.id !== id);
  state.responses = state.responses.filter((r) => r.survey_id !== id);
  if (state.surveys.length !== before) saveState();
  res.json({ success: true });
});

app.get('/api/admin/surveys/:id/responses', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const survey = state.surveys.find((s) => s.id === id);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const rows = state.responses
    .filter((r) => r.survey_id === id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  res.json({
    survey: { id: survey.id, slug: survey.slug, title: survey.title, fields: survey.fields },
    data: rows.slice(offset, offset + limit),
    page,
    total: rows.length,
    pages: Math.ceil(rows.length / limit) || 1,
  });
});

app.delete('/api/admin/responses/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const before = state.responses.length;
  state.responses = state.responses.filter((r) => r.id !== id);
  if (state.responses.length !== before) saveState();
  res.json({ success: true });
});

app.get('/api/admin/surveys/:id/export', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const survey = state.surveys.find((s) => s.id === id);
  if (!survey) return res.status(404).json({ error: 'ไม่พบแบบสอบถาม' });

  const rows = state.responses
    .filter((r) => r.survey_id === id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

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

app.get('/api/admin/stats', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    surveys: state.surveys.length,
    active_surveys: state.surveys.filter((s) => s.active).length,
    total_responses: state.responses.length,
    today_responses: state.responses.filter((r) => (r.created_at || '').startsWith(today)).length,
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/s/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'survey.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/surveys/:id', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-survey.html')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`Survey Platform listening on :${PORT}`);
  console.log(`Public:    http://localhost:${PORT}/`);
  console.log(`Admin:     http://localhost:${PORT}/admin`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`========================================`);
});

function shutdown() {
  console.log('Shutting down, flushing data...');
  saveStateSync();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
