// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { launchOptions }=require('../tools/lib/browser.cjs');
function withAngle(value,fn){const old=process.env.MVW_TEST_ANGLE;try{if(value===undefined)delete process.env.MVW_TEST_ANGLE;else process.env.MVW_TEST_ANGLE=value;fn();}finally{if(old===undefined)delete process.env.MVW_TEST_ANGLE;else process.env.MVW_TEST_ANGLE=old;}}
test('hardware backend selection never disables Chromium sandbox/security',()=>{for(const backend of ['vulkan','gl-egl','default'])withAngle(backend,()=>{const o=launchOptions();assert.equal(o.chromiumSandbox,true);assert.equal(o.headless,true);assert.ok(o.args.includes('--use-angle='+backend));assert.ok(!o.args.includes('--no-sandbox'));});});
test('backend input cannot inject flags or arbitrary renderer settings',()=>{for(const bad of ['vulkan --no-sandbox','swiftshader','--disable-web-security','unknown'])withAngle(bad,()=>assert.throws(()=>launchOptions(),/unsupported MVW_TEST_ANGLE/));});
test('unsafe flags remain refused even with hardware Vulkan selected',()=>{withAngle('vulkan',()=>{for(const bad of ['--no-sandbox','--disable-gpu-sandbox','--disable-web-security','--enable-unsafe-swiftshader','--ignore-certificate-errors'])assert.throws(()=>launchOptions([bad]),/weakens security/);});});
test('default backend behavior is unchanged',()=>{withAngle(undefined,()=>assert.ok(!launchOptions().args.some(a=>a.startsWith('--use-angle='))));});
