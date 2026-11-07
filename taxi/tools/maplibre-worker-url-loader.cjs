'use strict';
// MapLibre 6 constructs a runtime worker URL. The app pins that URL to /maps/;
// resolve it against the document, instead of creating a webpack asset context.
// Static new URL('./asset', import.meta.url) expressions remain webpack-owned.
module.exports = function maplibreWorkerUrl(source) {
  return source.replace(/new URL\(([$\w]+),\s*import\.meta\.url\)/g,
    'new URL($1,globalThis.location.href)');
};
