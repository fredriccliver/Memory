import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../policy/memory-guidance.mjs", import.meta.url), "utf8");
const generated = "// Generated from Memory/policy/memory-guidance.mjs by scripts/sync-memory-guidance.mjs.\n" + source;
const args = process.argv.slice(2);
const check = args[0] === "--check";
const destinations = check ? args.slice(1) : args;
if (!destinations.length) throw Error("Specify one or more consumer module paths");
for (const destination of destinations) {
  if (check) {
    if (readFileSync(destination, "utf8") !== generated)
      throw Error("Shared memory guidance is out of date: " + destination);
  } else {
    writeFileSync(destination, generated);
  }
}
