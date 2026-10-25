// Test the tester (gate kit; Lauren Tan: a check counts only once it is proven to fail on the real mistake).
// 1) the quick check must PASS on the code as it is; 2) each break in scripts/gate-breaks.mjs (real past bugs put
// back on purpose) is planted one at a time: the quick check must FAIL (naming `expect` when given) and the Stop hook
// must block; 3) every file goes back exactly as it was. Run it in the background, never under a time limit: the
// untouched file waits in .local/planted-break.json and the next run (or this one) puts it back.
//   node scripts/test-the-tester.mjs            exit 0 = every break caught, every file restored
// Don't edit this copy: change shared-ai-context/gate-kit, then install.mjs --update. The breaks live in gate-breaks.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, LAST, PLANTED, fingerprint, readJson } from './gate/kit.mjs';

const OUT = path.join(ROOT, '.proof', 'tester-last.json');
if (fs.existsSync(PLANTED)) {
  const left = readJson(PLANTED);
  fs.writeFileSync(path.join(ROOT, left.file), left.original);
  fs.rmSync(PLANTED, { force: true });
  console.log(`RESTORED ${left.file}: an earlier run was stopped while a break was planted`);
}
const breaks = (await import(pathToFileURL(path.join(ROOT, 'scripts', 'gate-breaks.mjs')).href)).default || [];
const env = { ...process.env, PLANTED_BY_TESTER: '1', GATE_BY: 'tester' };
const quick = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'quick-check.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, env });
const failLines = (r) => `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => /^FAIL/.test(l)).slice(0, 4);
const fp0 = fingerprint();
const report = { at: new Date().toISOString(), fp: fp0, breaks: [], result: 'FAIL' };
let missed = 0;

if (breaks.length < 2) { console.log(`FAIL only ${breaks.length} planted break(s) in scripts/gate-breaks.mjs: add at least 2, from real past bugs`); missed++; }
const base = quick();
const basePass = base.status === 0;
const baseStamp = fs.existsSync(LAST) ? fs.readFileSync(LAST, 'utf8') : '';
console.log(`${basePass ? 'PASS' : 'FAIL'} the quick check passes on the untouched code${basePass ? '' : `\n    ${failLines(base).join('\n    ')}`}`);
if (!basePass) missed++;

for (const b of basePass ? breaks : []) {
  const file = path.join(ROOT, b.file);
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  // a break written with \n still plants in a CRLF file
  if (original?.includes('\r\n') && !original.includes(b.from)) { b.from = b.from.replace(/\n/g, '\r\n'); b.to = b.to.replace(/\n/g, '\r\n'); }
  if (original === null || !original.includes(b.from)) { console.log(`FAIL ${b.name}: the line to break is gone from ${b.file}; update gate-breaks.mjs`); missed++; report.breaks.push({ name: b.name, caught: false, why: 'line moved' }); continue; }
  let caught = false, blocked = false, lines = [];
  try {
    fs.mkdirSync(path.dirname(PLANTED), { recursive: true });
    fs.writeFileSync(PLANTED, JSON.stringify({ file: b.file, original }));
    fs.writeFileSync(file, original.replace(b.from, b.to));
    const r = quick();
    lines = failLines(r);
    caught = r.status !== 0 && (!b.expect || new RegExp(b.expect, 'i').test(`${r.stdout}${r.stderr}`));
    const h = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'hooks', 'stop-check.mjs')], { cwd: ROOT, input: '{}', encoding: 'utf8', maxBuffer: 1 << 27, env });
    blocked = h.stdout.includes('"decision":"block"');
  } finally {
    fs.writeFileSync(file, original);
    fs.rmSync(PLANTED, { force: true });
  }
  if (!caught || !blocked) missed++;
  report.breaks.push({ name: b.name, what: b.what || '', caught, blocked });
  console.log(`${caught && blocked ? 'PASS' : 'FAIL'} ${b.name}${b.what ? ` (${b.what})` : ''}: quick check ${caught ? 'FAILED (caught it)' : b.expect ? `did not fail naming /${b.expect}/` : 'PASSED (missed it!)'}, Stop hook ${blocked ? 'blocked' : 'let the chat finish'}`);
  for (const l of lines) console.log(`    ${l}`);
}
fs.rmSync(path.join(ROOT, '.proof', 'gate-fails.json'), { force: true });
const restored = fingerprint() === fp0;
if (!restored) { console.log('FAIL files differ from before the run!'); missed++; }
// the untouched code is back: put back its PASS stamp so the Stop hook doesn't run the gate again for nothing
if (basePass && restored && baseStamp) fs.writeFileSync(LAST, baseStamp);
report.result = missed ? 'FAIL' : 'PASS';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`\n${missed ? `FAIL  the tester found ${missed} problem(s)` : `PASS  every planted break (${breaks.length}) was caught and every file restored`}`);
process.exit(missed ? 1 : 0);
