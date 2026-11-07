const DEFAULT_ROOT = 'https://ibronevik.ru/taxi'

function serviceRoot(value: string | undefined, fallback: string): string {
  const root = value?.trim() || fallback
  const url = new URL(root)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username || url.password || url.search || url.hash)
    throw new Error('Service endpoint must use HTTPS, or HTTP on loopback, without credentials or query parameters')
  return url.href.replace(/\/+$/, '')
}

export function serviceEndpoints(configName: string) {
  const root = serviceRoot(process.env.REACT_APP_API_ROOT, DEFAULT_ROOT)
  const dictionaryRoot = serviceRoot(process.env.REACT_APP_DICTIONARY_ROOT, `${root}/cache`)
  const name = encodeURIComponent(configName)
  return {
    serverUrl: `${root}/c/${name}`,
    apiUrl: `${root}/c/${name}/api/v1`,
    dictionaryUrl: `${dictionaryRoot}/data_${name}.js`,
  }
}
