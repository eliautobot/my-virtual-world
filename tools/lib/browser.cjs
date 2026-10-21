// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Browser launcher shared by the test tools (uitest, perf, shot, securecheck).
// Browser: MVW_TEST_BROWSER = a Playwright channel ("chrome", "chrome-beta", "msedge", ...) or the path of a
// Chromium-based browser. Default: "chrome", Playwright's documented channel for the installed Google Chrome.
// Security: the Chromium sandbox always stays on and flags that weaken security are refused. The one added flag,
// --enable-gpu, lets headless Chrome use the real GPU; MVW_TEST_GPU=0 leaves it out (software rendering).
'use strict';
const path = require('node:path');

const UNSAFE = [
  /^--no-sandbox\b/, /^--disable-setuid-sandbox\b/, /^--disable-gpu-sandbox\b/, /^--disable-web-security\b/,
  /^--disable-site-isolation-trials\b/, /^--allow-running-insecure-content\b/, /^--ignore-certificate-errors\b/,
  /^--enable-unsafe-swiftshader\b/, /^--use-gl=swiftshader\b/, /^--disable-features=.*(IsolateOrigins|site-per-process)/,
  /^--remote-debugging-address\b/, /^--remote-allow-origins\b/,
];

function launchOptions(extraArgs = []) {
  const args = process.env.MVW_TEST_GPU === '0' ? [] : ['--enable-gpu'];
  // Select an available ANGLE driver; this never disables Chromium's sandbox
  // or allows unsafe software fallback/security flags.
  const angle = process.env.MVW_TEST_ANGLE;
  if (angle) {
    if (!['default', 'vulkan', 'gl-egl'].includes(angle)) throw new Error('unsupported MVW_TEST_ANGLE backend');
    args.push(`--use-angle=${angle}`);
  }
  for (const a of extraArgs) {
    if (UNSAFE.some(re => re.test(a))) throw new Error(`refusing a browser flag that weakens security: ${a}`);
    args.push(a);
  }
  const which = process.env.MVW_TEST_BROWSER || 'chrome';
  const o = { headless: true, chromiumSandbox: true, args };
  if (which.includes('/') || which.includes(path.sep)) o.executablePath = which;
  else o.channel = which;
  return o;
}

function launch(extraArgs) {
  // Production releases omit dev dependencies. Pure option/security tests can
  // import this helper without Playwright; actual browser gates use NODE_PATH.
  const { chromium } = require('playwright-core');
  return chromium.launch(launchOptions(extraArgs));
}

/** The WebGL renderer a page gets: shows whether the real GPU or a software fallback is in use. */
function gpuInfo(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
}

const isSoftware = renderer => /SwiftShader|llvmpipe|softpipe|Software/i.test(renderer);

module.exports = { launch, launchOptions, gpuInfo, isSoftware };
