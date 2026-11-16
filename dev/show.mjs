import fs from 'node:fs';
const fails = JSON.parse(fs.readFileSync('/tmp/fails.json', 'utf8'));
const want = new Set(process.argv.slice(2));
for (const f of fails) {
  if (want.size && !want.has(f.id)) continue;
  console.log('=== ' + f.id + ' MD:', JSON.stringify(f.md));
  console.log('  GOT:', JSON.stringify(f.got));
  console.log('  EXP:', JSON.stringify(f.exp));
}
