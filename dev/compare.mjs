import { parse } from '/home/hatch/workspace/markdown-render-speed-02-entry/parse.js';
import fs from 'node:fs';
const kit = '/home/hatch/workspace/makefun/markdown-render-speed-02-kit/markdown-render-speed-02-kit';
const cases = JSON.parse(fs.readFileSync(kit + '/practice/input/cases.json', 'utf8'));
const exp = JSON.parse(fs.readFileSync(kit + '/practice/reference/expected.json', 'utf8'));
const expmap = {};
for (const c of exp.cases) expmap[c.id] = c.html;
let pass = 0; const fails = [];
const t0 = Date.now();
for (const c of cases) {
  let got;
  try { got = parse(c.markdown); } catch (e) { got = 'ERROR: ' + e.message; }
  if (got === expmap[c.id]) pass++;
  else fails.push({ id: c.id, md: c.markdown, got, exp: expmap[c.id] });
}
const ms = Date.now() - t0;
fs.writeFileSync('/tmp/fails.json', JSON.stringify(fails, null, 1));
const byGroup = {};
for (const f of fails) { const g = f.id.replace(/-\d+$/, ''); byGroup[g] = (byGroup[g] || 0) + 1; }
console.log(`PASS ${pass}/${cases.length}  time ${ms}ms`);
console.log('fails by group:', JSON.stringify(byGroup));
console.log('fail ids:', fails.map(f => f.id).join(' '));
