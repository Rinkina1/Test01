// Client-side storage layer — uses localStorage so the app works without a backend.
// For production with multi-user persistence, run server.js (see README).

(function (global) {
  const STORAGE_KEY = 'survey_platform_v1';
  const SESSION_KEY = 'survey_platform_session';
  const ADMIN_KEY = 'survey_platform_admin';

  const ALLOWED_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'radio', 'checkbox', 'select', 'rating'];
  const TYPES_WITH_OPTIONS = ['radio', 'checkbox', 'select'];

  function ensureAdmin() {
    if (!localStorage.getItem(ADMIN_KEY)) {
      localStorage.setItem(ADMIN_KEY, JSON.stringify({ username: 'admin', password: 'admin123' }));
    }
  }
  ensureAdmin();

  function loadDB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return initDB();
      const db = JSON.parse(raw);
      return {
        nextSurveyId: db.nextSurveyId || 1,
        nextResponseId: db.nextResponseId || 1,
        surveys: db.surveys || [],
        responses: db.responses || [],
      };
    } catch {
      return initDB();
    }
  }

  function initDB() {
    const db = { nextSurveyId: 1, nextResponseId: 1, surveys: [], responses: [] };
    saveDB(db);
    return db;
  }

  function saveDB(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function slugify(s) {
    return String(s).toLowerCase().trim()
      .replace(/[^\w฀-๿\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || Math.random().toString(36).slice(2, 8);
  }

  function normalizeField(f, idx) {
    if (!f || typeof f !== 'object') throw new Error(`field ${idx + 1} ไม่ถูกต้อง`);
    const type = String(f.type || 'text');
    if (!ALLOWED_TYPES.includes(type)) throw new Error(`คำถามที่ ${idx + 1}: type "${type}" ไม่รองรับ`);
    const label = String(f.label || '').trim();
    if (!label) throw new Error(`คำถามที่ ${idx + 1}: ต้องมีหัวข้อ`);
    const key = (String(f.key || '').trim() || `field_${idx + 1}`);
    if (!/^[a-zA-Z0-9_\-]+$/.test(key)) throw new Error(`คำถามที่ ${idx + 1}: key "${key}" ใช้ได้เฉพาะ a-z, 0-9, _, -`);

    const norm = { key, label, type, required: !!f.required };
    if (f.placeholder) norm.placeholder = String(f.placeholder);
    if (f.help) norm.help = String(f.help);
    if (TYPES_WITH_OPTIONS.includes(type)) {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        throw new Error(`คำถามที่ ${idx + 1}: ${type} ต้องมีตัวเลือกอย่างน้อย 1 ข้อ`);
      }
      norm.options = f.options.map((o) => String(o));
    }
    if (type === 'rating') {
      norm.max = Math.min(10, Math.max(2, parseInt(f.max) || 5));
    }
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

  const Store = {
    TYPES_WITH_OPTIONS,
    ALLOWED_TYPES,

    login(username, password) {
      const admin = JSON.parse(localStorage.getItem(ADMIN_KEY) || '{}');
      if (username === admin.username && password === admin.password) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          username, at: new Date().toISOString(),
        }));
        return true;
      }
      return false;
    },
    logout() { localStorage.removeItem(SESSION_KEY); },
    isLoggedIn() { return !!localStorage.getItem(SESSION_KEY); },
    currentUser() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
      catch { return null; }
    },
    requireAuth(redirectTo) {
      if (!this.isLoggedIn()) {
        location.href = redirectTo || 'login.html';
        return false;
      }
      return true;
    },
    changePassword(newPassword) {
      const admin = JSON.parse(localStorage.getItem(ADMIN_KEY) || '{}');
      admin.password = String(newPassword);
      localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    },

    getStats() {
      const db = loadDB();
      const today = new Date().toISOString().slice(0, 10);
      return {
        surveys: db.surveys.length,
        active_surveys: db.surveys.filter((s) => s.active).length,
        total_responses: db.responses.length,
        today_responses: db.responses.filter((r) => (r.created_at || '').startsWith(today)).length,
      };
    },

    getSurveys() {
      const db = loadDB();
      return db.surveys.map((s) => ({
        ...s,
        field_count: s.fields.length,
        response_count: db.responses.filter((r) => r.survey_id === s.id).length,
      }));
    },
    getSurvey(id) {
      return loadDB().surveys.find((s) => s.id === Number(id));
    },
    getSurveyBySlug(slug) {
      return loadDB().surveys.find((s) => s.slug === slug && s.active);
    },
    createSurvey({ title, slug, description, fields, active }) {
      if (!title || !Array.isArray(fields) || fields.length === 0) {
        throw new Error('ต้องมีชื่อและคำถามอย่างน้อย 1 ข้อ');
      }
      const db = loadDB();
      const base = slug ? slugify(slug) : slugify(title);
      let attempt = base, i = 1;
      while (db.surveys.some((x) => x.slug === attempt)) attempt = `${base}-${++i}`;

      const normalized = fields.map((f, idx) => normalizeField(f, idx));
      const seen = new Set();
      for (const f of normalized) {
        if (seen.has(f.key)) throw new Error(`key ซ้ำ: ${f.key}`);
        seen.add(f.key);
      }

      const now = new Date().toISOString();
      const survey = {
        id: db.nextSurveyId++,
        slug: attempt,
        title: String(title).trim(),
        description: String(description || '').trim(),
        fields: normalized,
        active: active !== false,
        created_at: now,
        updated_at: now,
      };
      db.surveys.push(survey);
      saveDB(db);
      return survey;
    },
    updateSurvey(id, { title, description, fields, active }) {
      const db = loadDB();
      const s = db.surveys.find((x) => x.id === Number(id));
      if (!s) throw new Error('ไม่พบแบบสอบถาม');
      if (title !== undefined) s.title = String(title).trim();
      if (description !== undefined) s.description = String(description || '').trim();
      if (typeof active === 'boolean') s.active = active;
      if (Array.isArray(fields)) {
        const normalized = fields.map((f, idx) => normalizeField(f, idx));
        const seen = new Set();
        for (const f of normalized) {
          if (seen.has(f.key)) throw new Error(`key ซ้ำ: ${f.key}`);
          seen.add(f.key);
        }
        s.fields = normalized;
      }
      s.updated_at = new Date().toISOString();
      saveDB(db);
      return s;
    },
    deleteSurvey(id) {
      const db = loadDB();
      db.surveys = db.surveys.filter((s) => s.id !== Number(id));
      db.responses = db.responses.filter((r) => r.survey_id !== Number(id));
      saveDB(db);
    },

    getResponses(surveyId, { page = 1, limit = 20 } = {}) {
      const all = loadDB().responses
        .filter((r) => r.survey_id === Number(surveyId))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const offset = (page - 1) * limit;
      return {
        data: all.slice(offset, offset + limit),
        total: all.length,
        page,
        pages: Math.ceil(all.length / limit) || 1,
      };
    },
    createResponse(slug, payload) {
      const db = loadDB();
      const survey = db.surveys.find((s) => s.slug === slug && s.active);
      if (!survey) throw new Error('ไม่พบแบบสอบถาม หรือถูกปิดอยู่');
      const { data, errors } = validateResponse(survey, payload || {});
      if (errors.length > 0) {
        const e = new Error(errors.join(', '));
        e.errors = errors;
        throw e;
      }
      const r = {
        id: db.nextResponseId++,
        survey_id: survey.id,
        survey_slug: survey.slug,
        data,
        user_agent: navigator.userAgent || '',
        created_at: new Date().toISOString(),
      };
      db.responses.push(r);
      saveDB(db);
      return r;
    },
    deleteResponse(id) {
      const db = loadDB();
      db.responses = db.responses.filter((r) => r.id !== Number(id));
      saveDB(db);
    },

    exportCSV(surveyId) {
      const db = loadDB();
      const survey = db.surveys.find((s) => s.id === Number(surveyId));
      if (!survey) return null;
      const rows = db.responses
        .filter((r) => r.survey_id === Number(surveyId))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      const headers = ['ID', ...survey.fields.map((f) => f.label), 'วันที่ตอบ'];
      const escape = (v) => {
        if (v == null) return '';
        const s = Array.isArray(v) ? v.join('; ') : String(v);
        const esc = s.replace(/"/g, '""');
        return /[",\n]/.test(esc) ? `"${esc}"` : esc;
      };
      const csv = [
        headers.map(escape).join(','),
        ...rows.map((r) => [
          r.id,
          ...survey.fields.map((f) => r.data?.[f.key]),
          r.created_at || '',
        ].map(escape).join(',')),
      ].join('\n');

      return {
        content: '﻿' + csv,
        filename: `${survey.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    },
    downloadCSV(surveyId) {
      const result = this.exportCSV(surveyId);
      if (!result) return;
      const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    exportAll() {
      return JSON.stringify(loadDB(), null, 2);
    },
    importAll(jsonString) {
      const db = JSON.parse(jsonString);
      if (!Array.isArray(db.surveys) || !Array.isArray(db.responses)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
      saveDB(db);
    },
    clearAll() {
      saveDB({ nextSurveyId: 1, nextResponseId: 1, surveys: [], responses: [] });
    },

    seedDemo() {
      const db = loadDB();
      if (db.surveys.length > 0) return null;
      const survey = this.createSurvey({
        title: 'แบบสอบถามความพึงพอใจลูกค้า',
        description: 'ขอบคุณที่ใช้บริการของเรา กรุณาสละเวลาเล็กน้อยเพื่อให้คะแนน',
        fields: [
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
        ],
      });
      return survey;
    },
  };

  global.Store = Store;
})(window);
