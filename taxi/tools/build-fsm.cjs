'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
if (!process.env.REACT_APP_FSM_API_URL?.trim()) throw new Error('Set the reviewed FSM backend URL before building the integration profile');
execFileSync(process.execPath, [path.join(__dirname, 'build-release.cjs')], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
  env: {
    ...process.env,
    REACT_APP_API_ROOT: process.env.REACT_APP_API_ROOT || 'https://ibronevik.itest24.com/taxi_dev2',
    REACT_APP_DICTIONARY_ROOT: process.env.REACT_APP_DICTIONARY_ROOT || 'https://ibronevik.itest24.com/taxi_dev2/cache',
    REACT_APP_SERVICE_CONFIG: process.env.REACT_APP_SERVICE_CONFIG || 'gruzvill',
    REACT_APP_ALLOWED_SERVICE_CONFIGS: process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS || 'gruzvill',
    REACT_APP_FSM_COMMAND_STATUS_ENABLED: 'true',
    REACT_APP_FSM_API_TOKEN: '',
  },
});
