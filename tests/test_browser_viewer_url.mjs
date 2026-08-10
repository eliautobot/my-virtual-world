#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildBrowserViewerUrl } from '../src/client/js/browser-viewer-url.mjs';

const baseUrl = 'http://localhost:8590/';

assert.equal(
  buildBrowserViewerUrl('https://browser.example.test/viewer', baseUrl),
  'https://browser.example.test/viewer?resize=scale&autoconnect=1',
  'viewer defaults should scale the remote display and connect automatically',
);

assert.equal(
  buildBrowserViewerUrl('https://browser.example.test/viewer?token=opaque#session', baseUrl),
  'https://browser.example.test/viewer?token=opaque&resize=scale&autoconnect=1#session',
  'unrelated query parameters and fragments should be preserved',
);

assert.equal(
  buildBrowserViewerUrl('https://browser.example.test/viewer?resize=remote&autoconnect=0', baseUrl),
  'https://browser.example.test/viewer?resize=remote&autoconnect=0',
  'explicit deployment-specific viewer modes should not be overwritten',
);

assert.equal(
  buildBrowserViewerUrl('/browser-viewer', baseUrl),
  'http://localhost:8590/browser-viewer?resize=scale&autoconnect=1',
  'same-origin viewer routes should be supported',
);

assert.equal(buildBrowserViewerUrl('', baseUrl), 'about:blank', 'an empty URL should remain safe');
assert.equal(buildBrowserViewerUrl('about:blank', baseUrl), 'about:blank', 'non-HTTP URLs should not receive KasmVNC parameters');

console.log('browser viewer URL checks passed');
