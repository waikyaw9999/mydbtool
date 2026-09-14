import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await import("./build-electron.mjs");

const electronPath = require("electron");
const child = spawn(electronPath, [root], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    MYDBTOOL_DEV: "1",
  },
});

const shutdown = () => {
  if (child.exitCode === null) child.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
