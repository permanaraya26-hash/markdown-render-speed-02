// context.mjs — print the markdown lines around a search string in a doc.
// usage: node dev/context.mjs <docId> <search string> [linesBefore] [linesAfter]
import fs from 'node:fs';
const kit = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/markdown-render-speed-02-kit';
const cases = JSON.parse(fs.readFileSync(kit + '/practice/input/cases.json', 'utf8'));
const doc = cases.find(c => c.id === process.argv[2]);
if (!doc) { console.log('no such doc'); process.exit(1); }
const needle = process.argv[3];
const before = +(process.argv[4] || 3);
const after = +(process.argv[5] || 3);
const lines = doc.markdown.split('\n');
const idx = lines.findIndex(l => l.includes(needle));
if (idx < 0) { console.log('needle not found'); process.exit(1); }
for (let k = Math.max(0, idx - before); k <= Math.min(lines.length - 1, idx + after); k++) {
  console.log((k === idx ? '>>> ' : '    ') + k + ': ' + JSON.stringify(lines[k]));
}
