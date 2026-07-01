// Cross-platform dev launcher: runs the API (port 4000) and web (port 5173)
// dev servers together. Zero external deps. Ctrl-C stops both.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const targets = [
  { name: "api", color: "\x1b[36m", args: ["run", "dev:api"] },
  { name: "web", color: "\x1b[35m", args: ["run", "dev:web"] },
];

const children = [];
let shuttingDown = false;

function prefix(name, color, chunk) {
  const reset = "\x1b[0m";
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.length) process.stdout.write(`${color}[${name}]${reset} ${line}\n`);
  }
}

for (const t of targets) {
  const child = spawn(npm, t.args, { cwd: process.cwd(), shell: false });
  child.stdout.on("data", (d) => prefix(t.name, t.color, d));
  child.stderr.on("data", (d) => prefix(t.name, t.color, d));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`\n[${t.name}] exited (code ${code}). Stopping all…`);
      shutdown();
    }
  });
  children.push(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
