'use strict';
/**
 * afterPack — trims the Chromium runtime we never touch.
 *
 * The FileDescription patch lives in aftersign.js instead: electron-builder
 * rewrites the exe's resources *after* afterPack runs, which silently undid it.
 *
 * dxcompiler.dll is the DirectX shader compiler for WebGPU/Dawn only; Lehtratuh
 * uses Canvas2D and CSS compositing, so it is never loaded. Everything else
 * (ffmpeg, d3dcompiler, swiftshader) stays so rendering keeps working on
 * machines without a GPU, in VMs and over RDP.
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const dir = context.appOutDir;

  // Runtime trim.
  const removable = ['dxcompiler.dll'];
  for (const file of removable) {
    const target = path.join(dir, file);
    try {
      if (fs.existsSync(target)) {
        const size = fs.statSync(target).size;
        fs.unlinkSync(target);
        console.log(`  • trimmed ${file} (${(size / 1048576).toFixed(1)} MB)`);
      }
    } catch (err) {
      console.warn(`  • could not trim ${file}: ${err.message}`);
    }
  }
};
