#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const command = process.argv[2];

if (command === "list-epics") {
  const epicsPath = resolve(import.meta.dir, "../specs/foundation/epics.json");
  const epics = JSON.parse(readFileSync(epicsPath, "utf-8"));

  console.log("Epics:\n");
  for (const epic of epics) {
    console.log(`  ${epic.id} — ${epic.title}`);
    console.log(`    Status: ${epic.status} | Priority: ${epic.priority} | Owner: ${epic.owner}`);
    console.log(`    ${epic.description.slice(0, 100)}${epic.description.length > 100 ? "..." : ""}`);
    console.log();
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: pm list-epics");
  process.exit(1);
}
