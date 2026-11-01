'use strict';
/**
 * afterSign — sets the Windows "Description" (FileDescription) shown in
 * Explorer, the Details tab and Task Manager.
 *
 * This has to run here, not in afterPack. electron-builder rewrites the
 * executable's resources in `signApp()` — after `afterPack` has returned — and
 * that rewrite puts `FileDescription` back to the product name (it is hard-coded
 * to `appInfo.productName` in winPackager.js). afterSign is the last hook that
 * touches the exe before the installer packs it, so the value finally sticks.
 *
 * The hook fires whether or not signing happened; electron-builder only skips it
 * when a certificate *did* sign and then failed, which cannot happen here.
 */
const fs = require('fs');
const path = require('path');

const FILE_DESCRIPTION = 'A Fluent Photo Gallery, Editor and Viewer';

function patch(exePath) {
  const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const infos = Resource.VersionInfo.fromEntries(res.entries);
  if (!infos.length) return false;

  let changed = 0;
  for (const info of infos) {
    for (const language of info.getAvailableLanguages()) {
      const strings = info.getStringValues(language);
      if (!strings) continue;
      strings.FileDescription = FILE_DESCRIPTION;
      info.setStringValues(language, strings);
      changed += 1;
    }
  }
  if (!changed) return false;

  for (const info of infos) info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  return true;
}

exports.default = async function afterSign(context) {
  const exe = path.join(context.appOutDir, 'Lehtratuh.exe');
  if (!fs.existsSync(exe)) return;
  try {
    const ok = patch(exe);
    console.log(ok
      ? `  • FileDescription → "${FILE_DESCRIPTION}"`
      : '  • FileDescription unchanged (no version resource)');
  } catch (err) {
    console.warn(`  • could not set file description: ${err.message}`);
  }
};
