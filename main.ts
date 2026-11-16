// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` on Node 22. It reads every case
// from cases.json under the input directory, renders each case alone
// with parse() from parse.js, and writes html.json under the output
// directory: a JSON array of the HTML strings, one per case, in the
// same order as the cases. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Load the case list. Accepts either a bare JSON array of cases or an
// object wrapping it under `cases` (the harness ships the bare array;
// the wrapper form is tolerated so a repackaged input still runs).
function loadCases(dir) {
  const raw = readFileSync(join(dir, 'cases.json'), 'utf8');
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : data?.cases;
  if (!Array.isArray(list)) {
    throw new Error(`cases.json must hold an array, got ${typeof data}`);
  }
  return list;
}

// Render every case alone, in order, into a pre-sized output array
// (no push growth over 720 renders).
function renderAll(list) {
  const html = new Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (typeof c?.markdown !== 'string') {
      throw new Error(`case ${c?.id ?? k} has no markdown string`);
    }
    html[k] = parse(c.markdown);
  }
  return html;
}

function main() {
  const started = Date.now();
  const list = loadCases(INPUT_DIR);
  const html = renderAll(list);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
  const ms = Date.now() - started;
  console.error(`markdown-render-speed-02: rendered ${list.length} cases in ${ms} ms`);
}

main();
