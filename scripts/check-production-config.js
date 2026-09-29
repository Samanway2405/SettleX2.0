#!/usr/bin/env node
/**
 * Fails the build when a variable that production needs is missing.
 *
 * Run from `.github/workflows/production-check.yml` before the build, so a
 * deployment that cannot serve a sign-in never gets built in the first place.
 *
 * The list of variables is NOT duplicated here. It is parsed out of
 * `lib/config/requirements.ts`, which `/api/health` also uses, so the pre-deploy
 * check and the running app can never disagree about what is required. This is
 * plain JS parsing TS source rather than importing it because the check has to
 * run before `tsc`, and the project carries no TypeScript loader for Node.
 *
 * Usage:
 *   node scripts/check-production-config.js              # required + recommended
 *   node scripts/check-production-config.js --strict     # warnings fail too
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "lib", "config", "requirements.ts");

/**
 * Pulls each `{ name, requirement, buildTime, impact }` entry out of the
 * CONFIG_REQUIREMENTS array literal.
 *
 * Deliberately strict: if the shape of that file changes so this stops matching,
 * the script exits non-zero rather than silently reporting an empty list and
 * letting a broken deployment through — a check that passes because it found
 * nothing to check is the exact failure this whole change is about.
 */
function parseRequirements(source) {
  const start = source.indexOf("CONFIG_REQUIREMENTS");
  if (start === -1) {
    throw new Error(`Could not find CONFIG_REQUIREMENTS in ${SOURCE}`);
  }

  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open === -1 || close === -1) {
    throw new Error(`Could not parse the CONFIG_REQUIREMENTS array in ${SOURCE}`);
  }

  const body = source.slice(open, close);
  const entries = [];

  const entryPattern = /\{([^{}]*)\}/g;
  let match;
  while ((match = entryPattern.exec(body)) !== null) {
    const chunk = match[1];

    const name = /name:\s*"([^"]+)"/.exec(chunk);
    const requirement = /requirement:\s*"([^"]+)"/.exec(chunk);
    const buildTime = /buildTime:\s*(true|false)/.exec(chunk);
    // `impact` spans lines and may be a concatenation of string literals, so
    // collect every literal between `impact:` and the end of the entry.
    const impactSlice = chunk.slice(chunk.indexOf("impact:"));
    const impact = [...impactSlice.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");

    if (!name || !requirement) continue;

    entries.push({
      name: name[1],
      requirement: requirement[1],
      buildTime: buildTime ? buildTime[1] === "true" : false,
      impact: impact.trim(),
    });
  }

  if (entries.length === 0) {
    throw new Error(`Parsed zero requirements from ${SOURCE} — refusing to pass vacuously.`);
  }

  return entries;
}

/** Pairs that must hold different values, parsed from the same file. */
function parseMustDiffer(source) {
  const start = source.indexOf("MUST_DIFFER");
  if (start === -1) return [];

  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open === -1 || close === -1) return [];

  const body = source.slice(open, close);
  const pairs = [];

  const entryPattern = /\{([^{}]*)\}/g;
  let match;
  while ((match = entryPattern.exec(body)) !== null) {
    const a = /\ba:\s*"([^"]+)"/.exec(match[1]);
    const b = /\bb:\s*"([^"]+)"/.exec(match[1]);
    if (a && b) pairs.push({ a: a[1], b: b[1] });
  }

  return pairs;
}

function isBlank(value) {
  return value === undefined || value.trim() === "";
}

function main() {
  const strict = process.argv.includes("--strict");
  const source = fs.readFileSync(SOURCE, "utf8");
  const requirements = parseRequirements(source);
  const mustDiffer = parseMustDiffer(source);

  const missingRequired = [];
  const missingRecommended = [];

  for (const entry of requirements) {
    if (!isBlank(process.env[entry.name])) {
      console.log(`  ok        ${entry.name}`);
      continue;
    }

    if (entry.requirement === "required") {
      missingRequired.push(entry);
      console.error(`::error::Missing required secret ${entry.name} — ${entry.impact}`);
    } else {
      missingRecommended.push(entry);
      console.error(`::warning::Missing recommended secret ${entry.name} — ${entry.impact}`);
    }
  }

  const conflicts = [];
  for (const pair of mustDiffer) {
    const left = process.env[pair.a];
    const right = process.env[pair.b];
    if (isBlank(left) || isBlank(right)) continue;
    if (left !== right) continue;

    conflicts.push(pair);
    console.error(
      `::error::${pair.a} must not be set to the same value as ${pair.b} — ` +
        "separate keys are the point of having two.",
    );
  }

  console.log("");
  console.log(`Checked ${requirements.length} configuration variables.`);

  if (missingRequired.length > 0 || conflicts.length > 0) {
    console.error(
      `Production configuration is incomplete: ${missingRequired.length} required ` +
        `variable(s) missing, ${conflicts.length} conflict(s). ` +
        "A deployment in this state cannot serve a sign-in.",
    );
    process.exit(1);
  }

  if (strict && missingRecommended.length > 0) {
    console.error(
      `--strict: ${missingRecommended.length} recommended variable(s) missing.`,
    );
    process.exit(1);
  }

  if (missingRecommended.length > 0) {
    console.log(
      `${missingRecommended.length} recommended variable(s) missing — ` +
        "the deployment will run degraded. See the warnings above.",
    );
  }

  console.log("All required configuration is present.");
}

try {
  main();
} catch (err) {
  console.error(`::error::Configuration check could not run: ${err.message}`);
  process.exit(1);
}
