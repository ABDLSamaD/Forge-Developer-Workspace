"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const requiredFiles = [
  "main.js",
  "ipc.js",
  "process-service.js",
  "store.js",
  "db.js",
  "backup.js",
  "preload.js",
  path.join("renderer", "index.html"),
  path.join("renderer", "styles.css"),
];

let failures = 0;

for (const rel of requiredFiles) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) {
    console.log(`ok   ${rel}`);
  } else {
    failures++;
    console.error(`miss ${rel}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const buildFiles = pkg.build && Array.isArray(pkg.build.files) ? pkg.build.files : [];
if (!buildFiles.includes("process-service.js")) {
  failures++;
  console.error("miss build.files entry: process-service.js");
} else {
  console.log("ok   build.files includes process-service.js");
}

if (failures > 0) {
  console.error(`Build validation failed: ${failures} issue(s)`);
  process.exit(1);
}

console.log("Build validation passed");
