// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A file that comes with the message itself (data, base64 — an agent's eyes' picture, server/senses/eye.js) goes to
// OpenClaw and to Hermes as a file on disk does: the same bytes, the same shape of request, nothing read from disk; and a
// file on disk still goes as it did.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LinkChat as OpenClawChat } from '../../server/providers/openclaw/chat.js';
import { LinkChat as HermesChat } from '../../server/providers/hermes/chat.js';

const BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(700, 3)]);
const inline = { name: 'what-you-see.jpg', mime: 'image/jpeg', size: BYTES.length, data: BYTES.toString('base64') };

test('OpenClaw: a picture with the message goes as the gateway takes a file — base64, its size checked against its limits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-inline-'));
  try {
    const onDisk = path.join(dir, 'a.png');
    fs.writeFileSync(onDisk, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const chat = new OpenClawChat({ hello: { policy: { attachments: { maxImageBytes: 5 * 1048576, maxBytes: 5 * 1048576 }, maxPayload: 25 * 1048576 } } }, { emit: () => {}, kind: 'openclaw' });
    const out = await chat.files([inline, { name: 'a.png', mime: 'image/png', size: 7, path: onDisk }]);
    assert.deepEqual(out[0], { type: 'image', mimeType: 'image/jpeg', fileName: 'what-you-see.jpg', origin: 'file', content: BYTES.toString('base64'), sizeBytes: BYTES.length });
    assert.equal(out[1].content, fs.readFileSync(onDisk).toString('base64'), 'a file on disk as before');
    const small = new OpenClawChat({ hello: { policy: { attachments: { maxImageBytes: 100 } } } }, { emit: () => {}, kind: 'openclaw' });
    await assert.rejects(() => small.files([inline]), e => e.code === 'too_large', 'its limits apply to it too');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Hermes: a picture with the message is queued for the turn like any picture (image.attach_bytes), the same bytes', async () => {
  const calls = [];
  const link = { request: async (method, p) => { calls.push({ method, p }); return method === 'image.attach_bytes' ? { attached: true } : { attached: true, ref_text: '@file:x' }; } };
  const chat = new HermesChat(link, { emit: () => {}, kind: 'hermes' });
  const text = await chat.files('sid1', 'default', [inline], 'What colour is it?');
  assert.equal(text, 'What colour is it?', 'a picture adds no reference to the words');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'image.attach_bytes');
  assert.equal(calls[0].p.content_base64, BYTES.toString('base64'));
  assert.equal(calls[0].p.filename, 'what-you-see.jpg');
  assert.equal(calls[0].p.ext, 'jpg');
});
