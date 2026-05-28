// API client — talks to server.js (which persists data in SQLite).

(function (global) {
  const TYPES_WITH_OPTIONS = ['radio', 'checkbox', 'select'];
  const ALLOWED_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'radio', 'checkbox', 'select', 'rating'];

  async function http(method, url, body) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: {},
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error('เชื่อมต่อ server ไม่ได้ — กรุณาตรวจสอบว่ารัน "npm start" แล้ว');
    }
    if (res.status === 401) {
      const err = new Error('กรุณา login');
      err.unauthorized = true;
      throw err;
    }
    let payload = null;
    try { payload = await res.json(); } catch {}
    if (!res.ok) {
      throw new Error((payload && payload.error) || `HTTP ${res.status}`);
    }
    return payload;
  }

  const Store = {
    TYPES_WITH_OPTIONS,
    ALLOWED_TYPES,

    async login(username, password) {
      try {
        await http('POST', '/api/admin/login', { username, password });
        return true;
      } catch (err) {
        if (err.unauthorized) return false;
        throw err;
      }
    },
    async logout() {
      try { await http('POST', '/api/admin/logout'); } catch {}
    },
    async isLoggedIn() {
      try {
        await http('GET', '/api/admin/me');
        return true;
      } catch {
        return false;
      }
    },
    async requireAuth(redirectTo) {
      const ok = await this.isLoggedIn();
      if (!ok) {
        location.href = redirectTo || 'login.html';
        return false;
      }
      return true;
    },

    async getStats() {
      return await http('GET', '/api/admin/stats');
    },

    async getPublicSurveys() {
      const r = await http('GET', '/api/surveys');
      return r.surveys;
    },
    async getSurveys() {
      const r = await http('GET', '/api/admin/surveys');
      return r.surveys;
    },
    async getSurvey(id) {
      const r = await http('GET', `/api/admin/surveys/${id}`);
      return r.survey;
    },
    async getSurveyBySlug(slug) {
      return await http('GET', `/api/surveys/${encodeURIComponent(slug)}`);
    },
    async createSurvey(payload) {
      const r = await http('POST', '/api/admin/surveys', payload);
      return r.survey;
    },
    async updateSurvey(id, payload) {
      const r = await http('PUT', `/api/admin/surveys/${id}`, payload);
      return r.survey;
    },
    async deleteSurvey(id) {
      await http('DELETE', `/api/admin/surveys/${id}`);
    },

    async getResponses(surveyId, { page = 1, limit = 20 } = {}) {
      return await http('GET', `/api/admin/surveys/${surveyId}/responses?page=${page}&limit=${limit}`);
    },
    async createResponse(slug, payload) {
      return await http('POST', `/api/surveys/${encodeURIComponent(slug)}/responses`, payload);
    },
    async deleteResponse(id) {
      await http('DELETE', `/api/admin/responses/${id}`);
    },

    downloadCSV(surveyId) {
      window.location.href = `/api/admin/surveys/${surveyId}/export`;
    },

    async seedDemo() {
      const r = await http('POST', '/api/admin/seed-demo');
      return r.survey;
    },
  };

  global.Store = Store;
})(window);
