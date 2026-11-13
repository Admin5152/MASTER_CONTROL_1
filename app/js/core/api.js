// Backend calls. All URLs are relative so the page works from any host.
async function req(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    init.body = body;
    init.headers["Content-Type"] = "audio/wav";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  init.signal = ctrl.signal;
  try {
    const r = await fetch(url, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.detail || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  health: () => req("GET", "../api/health"),
  crew: () => req("GET", "../api/crew"),
  state: (id) => req("GET", `../api/state/${id}`, undefined, { timeout: 3000 }),
  aux: (id) => req("GET", `../api/aux/${id}`, undefined, { timeout: 3000 }),
  patch: (id, patch) => req("POST", `../api/state/${id}/patch`, patch),
  history: (id, field) => req("GET", `../api/history/${id}?field=${encodeURIComponent(field)}`),
  log: (id, field, value, source = "user") => req("POST", `../api/log/${id}`, { field, value, source }),
  chat: (crew_id, transcript) => req("POST", "../api/chat", { crew_id, transcript }, { timeout: 10000 }),
  identify: (wav) => req("POST", "../api/identify", wav, { timeout: 15000 }),
  enrol: (id, wav) => req("POST", `../api/enrol/${id}`, wav, { timeout: 30000 }),
  cabin: (body) => req("POST", "../api/cabin", body),
  scenario: (name, params = "") => req("POST", `../api/scenario/${name}${params}`),
  spaceweather: () => req("GET", "../api/spaceweather"),
  clock: (hours) => req("POST", "../api/clock", { advance_hours: hours }),
  json: (path) => req("GET", path),
};
