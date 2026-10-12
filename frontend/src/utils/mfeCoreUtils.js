export const mfeLog = {
  info: (msg, ...args) => console.log(`%c[MFE::SHELL] INFO: ${msg}`, 'color: #3b82f6; font-weight: bold;', ...args),
  warn: (msg, ...args) => console.warn(`%c[MFE::SHELL] WARN: ${msg}`, 'color: #f59e0b; font-weight: bold;', ...args),
  error: (msg, ...args) => console.error(`%c[MFE::SHELL] ERROR: ${msg}`, 'color: #ef4444; font-weight: bold;', ...args),
  debug: (msg, ...args) => console.debug(`%c[MFE::SHELL] DEBUG: ${msg}`, 'color: #10b981; font-weight: bold;', ...args),
};

if (typeof window !== 'undefined') {
  window.__MFE_GLOBAL_CACHE__ = window.__MFE_GLOBAL_CACHE__ || new Map();
}

export const mfeCache = {
  set: (key, data, ttlMs = 60000) => {
    if (typeof window === 'undefined') return;
    const expires = Date.now() + ttlMs;
    window.__MFE_GLOBAL_CACHE__.set(key, { data, expires });
  },
  get: (key) => {
    if (typeof window === 'undefined') return null;
    const item = window.__MFE_GLOBAL_CACHE__.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      window.__MFE_GLOBAL_CACHE__.delete(key);
      return null;
    }
    return item.data;
  },
  clear: () => {
    if (typeof window !== 'undefined') {
      window.__MFE_GLOBAL_CACHE__.clear();
    }
  }
};
