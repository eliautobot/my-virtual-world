import assert from 'node:assert/strict';
import { PROVIDER_CONNECTION_GUIDES, connectionHelpContent } from '../src/client/js/connection-help.mjs';

const requiredProviders = ['openclaw', 'hermes', 'codex', 'claude-code', 'opencode', 'antigravity'];
const commonFields = [
  { key:'enabled', label:'Enabled', type:'boolean', default:true },
  { key:'binary', label:'Executable', type:'path' },
  { key:'homePath', label:'Home directory', type:'path' },
  { key:'workspaceRoot', label:'Workspace root', type:'path' },
  { key:'timeoutSec', label:'Turn timeout', type:'number', default:900 },
  { key:'model', label:'Default model', type:'model', placeholder:'Use the runtime default' },
  { key:'followActiveSession', label:'Follow active session', type:'boolean', default:true },
  { key:'sessionSyncIntervalSec', label:'Session sync interval', type:'number', default:3 },
];

for (const providerId of requiredProviders) {
  const guide = PROVIDER_CONNECTION_GUIDES[providerId];
  assert.ok(guide, `${providerId} guide exists`);
  for (const key of ['name', 'summary', 'expectedDefault', 'linux', 'windows', 'requirements']) {
    assert.ok(String(guide[key] || '').trim(), `${providerId}.${key} is documented`);
  }
  const fields = [
    ...commonFields,
    ...Object.keys(guide.defaults || {}).map(key => ({ key, label:key })),
  ];
  for (const field of fields) {
    const content = connectionHelpContent(providerId, field);
    for (const key of ['title', 'purpose', 'expectedDefault', 'providerDefault', 'linux', 'windows', 'requirements']) {
      assert.ok(String(content[key] || '').trim(), `${providerId}.${field.key}.${key} is populated`);
    }
  }
}

const extension = connectionHelpContent('third-party-provider', { key:'endpoint', label:'Endpoint URL' });
assert.match(extension.windows, /Windows/i);
assert.ok(extension.expectedDefault);

console.log('Connection help coverage passed for all built-in providers and generic SDK extensions.');
