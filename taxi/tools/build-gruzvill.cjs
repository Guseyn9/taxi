'use strict';
// Reproducible tenant build: the dictionary and API always switch together.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
execFileSync(process.execPath, [path.join(__dirname, 'build-release.cjs')], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    REACT_APP_API_ROOT: 'https://ibronevik.itest24.com/taxi_dev2',
    REACT_APP_DICTIONARY_ROOT: 'https://ibronevik.itest24.com/taxi_dev2/cache',
    REACT_APP_SERVICE_CONFIG: 'gruzvill',
    REACT_APP_ALLOWED_SERVICE_CONFIGS: 'gruzvill',
    REACT_APP_FSM_API_URL: '',
    REACT_APP_FSM_API_TOKEN: '',
    REACT_APP_OAUTH_STATE_SUPPORTED: 'false',
  },
});
