'use strict';

/** Local development only. WDS also accepts arbitrary IP origins internally. */
module.exports = function createDevServerAccessPolicy(host, allowedHost, port, secure = false) {
  const hostnames = new Set();
  for (const value of ['localhost', '127.0.0.1', '[::1]', host, allowedHost]) {
    if (!value) continue;
    try {
      const authority = value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
      hostnames.add(new URL(`http://${authority}`).hostname);
    } catch { /* An invalid configured host cannot grant access. */ }
  }
  const origins = new Set(Array.from(hostnames, name => new URL(`${secure ? 'https' : 'http'}://${name}:${port}`).origin));
  const invalid = value => typeof value !== 'string' || !value || /[\s\\/@#?,\u0000-\u001f\u007f]/.test(value);
  const isAllowedHost = value => {
    if (invalid(value)) return false;
    try {
      const parsed = new URL(`http://${value}`);
      return !parsed.username && !parsed.password && hostnames.has(parsed.hostname);
    } catch { return false; }
  };
  const isAllowedOrigin = value => {
    if (typeof value !== 'string' || !value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    try {
      const parsed = new URL(value);
      return !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash && origins.has(parsed.origin);
    } catch { return false; }
  };
  return { hostnames: Object.freeze(Array.from(hostnames)), isAllowedHost, isAllowedOrigin };
};
