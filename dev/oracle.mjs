// oracle.mjs — run vendored marked 18.1.3 and our parse.js on the same
// markdown (file path in argv[2], default /tmp/snippet.md) and print both.
import fs from 'node:fs';
import { marked } from '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/markdown-render-speed-02-kit/baselines/vendor/marked/marked.esm.js';
import { parse } from '/home/hatch/workspace/markdown-render-speed-02-entry/parse.js';
const file = process.argv[2] || '/tmp/snippet.md';
const md = fs.readFileSync(file, 'utf8');
console.log('MD    :', JSON.stringify(md));
console.log('MARKED:', JSON.stringify(marked.parse(md)));
console.log('MINE  :', JSON.stringify(parse(md)));
console.log('MATCH :', marked.parse(md) === parse(md));
