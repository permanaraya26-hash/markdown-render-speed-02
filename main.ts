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

const raw = readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8');
const cases = JSON.parse(raw) as { id: string; markdown: string }[];
if (!Array.isArray(cases)) {
  throw new Error(`cases.json must hold an array, got ${typeof cases}`);
}

// Pre-size the output so the 720 renders land by index with no
// push growth; each case is rendered alone, in order.
const html: string[] = new Array(cases.length);
for (let k = 0; k < cases.length; k++) {
  const c = cases[k];
  if (typeof c.markdown !== 'string') {
    throw new Error(`case ${c?.id ?? k} has no markdown string`);
  }
  html[k] = parse(c.markdown);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
