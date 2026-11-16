// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` on Node 22. It reads every case
// from cases.json under the input directory, renders each case alone
// with parse() from parse.js, and writes html.json under the output
// directory: a JSON array of the HTML strings, one per case, in the
// same order as the cases. Outside a container, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Case = { id: string; markdown: string };

// Read cases.json: either a bare array of cases or an object holding
// them under `cases`. Each case must carry a markdown string.
function loadCases(): Case[] {
  const raw = readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const cases = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases)) {
    throw new Error(`cases.json must hold an array, got ${typeof cases}`);
  }
  return cases as Case[];
}

// Render every case alone, in order, into a pre-sized array so the
// 720 renders land by index with no push growth.
function renderAll(cases: Case[]): string[] {
  const html: string[] = new Array(cases.length);
  for (let k = 0; k < cases.length; k++) {
    const c = cases[k];
    if (typeof c.markdown !== 'string') {
      throw new Error(`case ${c?.id ?? k} has no markdown string`);
    }
    const out = parse(c.markdown);
    if (typeof out !== 'string') {
      throw new Error(`case ${c?.id ?? k} did not render to a string`);
    }
    html[k] = out;
  }
  return html;
}

const started = Date.now();
const cases = loadCases();
const html = renderAll(cases);

mkdirSync(OUTPUT_DIR, { recursive: true });
// Atomic write: the harness never sees a half-written html.json.
const target = join(OUTPUT_DIR, 'html.json');
const tmp = target + '.tmp';
writeFileSync(tmp, JSON.stringify(html));
renameSync(tmp, target);
console.error(`rendered ${cases.length} cases in ${Date.now() - started} ms`);
