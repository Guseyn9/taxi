'use strict';
require('./tools/check-entrypoints.cjs').assertEntryPoints(__dirname);
require('./tools/prepare-road-graph.cjs').prepare();

const fs = require('fs');
const path = require('path');

const versionPath = path.resolve(process.cwd(), 'src', 'version.json');

let versionInfo = {};

try {
  versionInfo = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
} catch (error) {
  console.warn('Cannot read src/version.json, creating a new version object');
}

// Release metadata is stable across builds. Operators may explicitly supply a
// reproducible epoch; ordinary build/start hooks must not dirty the source tree.
if (process.env.SOURCE_DATE_EPOCH !== undefined) {
  const seconds = Number(process.env.SOURCE_DATE_EPOCH);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Invalid SOURCE_DATE_EPOCH');
  versionInfo.buildTimestamp = new Date(seconds * 1000).toISOString();
  const content = `${JSON.stringify(versionInfo, null, 2)}\n`;
  if (fs.readFileSync(versionPath, 'utf8') !== content) fs.writeFileSync(versionPath, content);
}
