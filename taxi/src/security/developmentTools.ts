/** Privileged graph and test-position controls are available only on a local development server. */
export function developmentToolsEnabled(production = process.env.NODE_ENV === 'production', hostname = window.location.hostname): boolean {
  return !production && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}
