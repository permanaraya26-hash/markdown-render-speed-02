// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` on Node 22. It reads every case
// from cases.json under the input directory, renders each case alone
// with parse() from parse.js, and writes html.json under the output
// directory: a JSON array of the HTML strings, one per case, in the
// same order as the cases. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// Cases may arrive as a bare JSON array or wrapped in an object with a
// `cases` field; both shapes are accepted so the driver is robust to
// either harness layout.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Read cases.json and return the case array, accepting either a bare
// array or a {cases: [...]} wrapper.
function loadCases(): { id: string; markdown: string }[] {
  const raw = readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8');
  const data: unknown = JSON.parse(raw);
  const cases = Array.isArray(data) ? data : (data as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) {
    throw new Error(`cases.json must hold an array (or {cases: [...]}), got ${typeof data}`);
  }
  return cases as { id: string; markdown: string }[];
}

const cases = loadCases();

// Pre-size the output so the 720 renders land by index with no
// push growth; each case is rendered alone, in order. Every render
// must come back a string — a non-string would mean parse() broke
// its contract, so fail loudly instead of writing bad output.
const html: string[] = new Array(cases.length);
for (let k = 0; k < cases.length; k++) {
  const c = cases[k];
  if (typeof c.markdown !== 'string') {
    throw new Error(`case ${c?.id ?? k} has no markdown string`);
  }
  const out = parse(c.markdown);
  if (typeof out !== 'string') {
    throw new Error(`case ${c?.id ?? k} rendered to ${typeof out}, not a string`);
  }
  html[k] = out;
}

// Write atomically: land the bytes in a temp file beside the target,
// then rename, so a crash mid-write never leaves a partial html.json.
mkdirSync(OUTPUT_DIR, { recursive: true });
const target = join(OUTPUT_DIR, 'html.json');
const temp = target + '.tmp';
writeFileSync(temp, JSON.stringify(html));
renameSync(temp, target);
