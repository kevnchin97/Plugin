/**
 * electron-builder afterPack hook: copy the engine (server bundle + its packages, the standalone
 * web app, migrations) into the app's resources folder. electron-builder's own extraResources
 * drops node_modules folders, which both need; the installer is made from this folder afterwards.
 */
const { cpSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const stage = path.join(__dirname, "..", ".stage");
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  for (const dir of ["server", "web", "migrations"])
    cpSync(path.join(stage, dir), path.join(resources, dir), { recursive: true, verbatimSymlinks: true });
};
