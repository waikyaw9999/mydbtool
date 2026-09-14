import fs from "node:fs";
import path from "node:path";

function resourcesDir(context) {
  const product = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "darwin") {
    return path.join(context.appOutDir, `${product}.app`, "Contents", "Resources");
  }
  return path.join(context.appOutDir, "resources");
}

function materializeHashedDriverLinks(standaloneDir) {
  const hashed = path.join(standaloneDir, ".next", "node_modules");
  if (!fs.existsSync(hashed)) return;
  for (const name of fs.readdirSync(hashed)) {
    const full = path.join(hashed, name);
    const st = fs.lstatSync(full);
    if (!st.isSymbolicLink()) continue;
    const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
    fs.unlinkSync(full);
    if (fs.existsSync(target)) {
      fs.cpSync(target, full, { recursive: true, dereference: true });
    }
  }
}

export default async function afterPack(context) {
  const standaloneDir = path.join(resourcesDir(context), "standalone");
  const srcModules = path.join(context.packager.projectDir, ".next", "standalone", "node_modules");
  const destModules = path.join(standaloneDir, "node_modules");

  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    throw new Error(`Packaged standalone server missing at ${standaloneDir}`);
  }
  if (!fs.existsSync(srcModules)) {
    throw new Error(`Missing ${srcModules}. Run npm run build before electron:build.`);
  }

  // electron-builder extraResources omits node_modules; copy them unpacked so
  // Next.js and the DB drivers (pg, mysql2, mssql, mongodb) can load at runtime.
  fs.cpSync(srcModules, destModules, { recursive: true, dereference: true, force: true });
  materializeHashedDriverLinks(standaloneDir);

  if (!fs.existsSync(path.join(destModules, "pg"))) {
    throw new Error("Packaged standalone is missing the pg driver.");
  }
}
