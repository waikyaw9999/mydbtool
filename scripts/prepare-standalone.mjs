import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const serverJs = path.join(standalone, "server.js");
const withNode = process.argv.includes("--with-node");

if (!fs.existsSync(serverJs)) {
  console.error("Missing .next/standalone/server.js. Run `npm run build` first.");
  process.exit(1);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true });
}

copyDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
copyDir(path.join(root, "public"), path.join(standalone, "public"));

const driverPackages = ["pg", "mysql2", "mssql", "mongodb", "tedious"];
for (const name of driverPackages) {
  const src = path.join(root, "node_modules", name);
  const dest = path.join(standalone, "node_modules", name);
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`Copied ${name} into the standalone server (file tracing missed it).`);
  }
}

if (withNode) {
  const destName = process.platform === "win32" ? "node.exe" : "node";
  const dest = path.join(standalone, destName);
  fs.copyFileSync(process.execPath, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`Bundled Node runtime for the desktop app: ${dest}`);
}

const hashedModules = path.join(standalone, ".next", "node_modules");
if (fs.existsSync(hashedModules)) {
  for (const name of fs.readdirSync(hashedModules)) {
    const full = path.join(hashedModules, name);
    const st = fs.lstatSync(full);
    if (!st.isSymbolicLink()) continue;
    const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
    if (!fs.existsSync(target)) continue;
    fs.unlinkSync(full);
    fs.cpSync(target, full, { recursive: true, dereference: true });
  }
}

console.log("Prepared Next.js standalone output for Electron.");
