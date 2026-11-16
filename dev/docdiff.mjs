// docdiff.mjs — show the first difference between got and expected HTML
// for a failing doc, with surrounding context, plus the markdown around
// the corresponding source position (approximate: search the markdown for
// a distinctive snippet near the diff).
import fs from 'node:fs';
const fails = JSON.parse(fs.readFileSync('/tmp/fails.json', 'utf8'));
const want = new Set(process.argv.slice(2));
for (const f of fails) {
  if (want.size && !want.has(f.id)) continue;
  const got = f.got, exp = f.exp;
  let i = 0;
  while (i < got.length && i < exp.length && got[i] === exp[i]) i++;
  console.log('=== ' + f.id + ' first diff at char ' + i +
    ' (gotLen ' + got.length + ' expLen ' + exp.length + ')');
  console.log('  GOT ...' + JSON.stringify(got.slice(Math.max(0, i - 120), i + 200)));
  console.log('  EXP ...' + JSON.stringify(exp.slice(Math.max(0, i - 120), i + 200)));
}
