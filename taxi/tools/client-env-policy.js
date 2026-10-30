'use strict';
function assertBrowserEnvironment(env) {
  for (const key of Object.keys(env)) {
    if (/^REACT_APP_FSM_API_TOKEN$/i.test(key) && String(env[key] || '').trim())
      throw new Error('REACT_APP_FSM_API_TOKEN must not be bundled in the browser. Use a server proxy with a user session; never a shared server credential.');
  }
}
module.exports={assertBrowserEnvironment};
