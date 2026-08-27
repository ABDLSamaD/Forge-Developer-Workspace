"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mustExist = [
  "main.js",
  "ipc.js",
  "process-service.js",
  "store.js",
  "db.js",
  "backup.js",
  "preload.js",
];

let failures = 0;

for (const rel of mustExist) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures++;
    console.error(`missing: ${rel}`);
  }
}

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = pkg.build && pkg.build.files ? pkg.build.files : [];
  if (!files.includes("process-service.js")) {
    failures++;
    console.error("missing build file manifest entry: process-service.js");
  }
} catch (err) {
  failures++;
  console.error(`package.json parse failed: ${err.message}`);
}

if (failures > 0) {
  console.error(`build smoke failed (${failures} issue(s))`);
  process.exit(1);
}

console.log("build smoke passed");
