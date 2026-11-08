'use strict';
function assertBrowserEnvironment(env) {
  for (const key of ['REACT_APP_API_ROOT','REACT_APP_DICTIONARY_ROOT','REACT_APP_FSM_API_URL']) {
    if (!String(env[key] || '').trim()) continue;
    const url = new URL(env[key]);
    const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash)
      throw new Error(key + ' must be a secure service root without credentials or query parameters');
  }
  if (env.REACT_APP_SERVICE_CONFIG && !/^[A-Za-z0-9_-]+$/.test(env.REACT_APP_SERVICE_CONFIG))
    throw new Error('REACT_APP_SERVICE_CONFIG must be a tenant name');
  if (env.NODE_ENV === 'production' && env.REACT_APP_FSM_API_URL) {
    if (env.REACT_APP_FSM_COMMAND_STATUS_ENABLED !== 'true')
      throw new Error('FSM requires REACT_APP_FSM_COMMAND_STATUS_ENABLED=true; acceptance is not completion');
    if (env.REACT_APP_FSM_DRIVER_USER_ID || env.REACT_APP_FSM_ORDER_ID)
      throw new Error('Production FSM identity must come from the signed-in session and selected order');
  }
  for (const key of Object.keys(env)) {
    if (/^REACT_APP_FSM_API_TOKEN$/i.test(key) && String(env[key] || '').trim())
      throw new Error('REACT_APP_FSM_API_TOKEN must not be bundled in the browser. Use a server proxy with a user session; never a shared server credential.');
  }
}
module.exports={assertBrowserEnvironment};
