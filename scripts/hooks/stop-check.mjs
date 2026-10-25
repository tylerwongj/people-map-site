// Claude Code Stop hook (gate kit; wired in .claude/settings.json as node "$CLAUDE_PROJECT_DIR/scripts/hooks/stop-check.mjs"
// so it runs on the PC and the Mac). When a chat tries to finish and a source file changed since the last PASS, run
// scripts/quick-check.mjs. FAIL = the chat is told what broke and keeps working. Nothing changed = instant.
// Two chats in one folder: the second waits for the first run and uses its result (no port clash).
// After 3 fails on the same version the chat may stop, but must tell Tyler (no endless loop).
// Don't edit this copy: change shared-ai-context/gate-kit, then install.mjs --update.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LAST, fingerprint, readJson } from '../gate/kit.mjs';

try { fs.readFileSync(0, 'utf8'); } catch { /* run by hand: no hook input */ }
const name = path.basename(ROOT);
const LOCK = path.join(ROOT, '.proof', 'gate-run.lock');
const FAILS = path.join(ROOT, '.proof', 'gate-fails.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(ROOT, '.proof'), { recursive: true });

let fp = fingerprint();
let last = readJson(LAST);
if (!(last?.fp === fp)) {
  // another chat is running this gate: wait for it (up to 25 min: the test line may queue its browsers), then re-read
  const waitUntil = Date.now() + Number(process.env.GATE_LOCK_WAIT_MS || 25 * 60000);
  for (let l = readJson(LOCK); l && alive(l.pid) && l.pid !== process.pid && Date.now() < waitUntil; l = readJson(LOCK)) await sleep(2000);
  fp = fingerprint();
  last = readJson(LAST);
  if (!(last?.fp === fp)) {
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, fp, at: new Date().toISOString() }));
    let r;
    try {
      r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'quick-check.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, GATE_BY: process.env.GATE_BY || 'stop-hook' } });
    } finally { fs.rmSync(LOCK, { force: true }); }
    last = readJson(LAST);
    if (!(last?.fp === fp)) { // a quick check that doesn't stamp (or crashed before it could): record its exit code here
      last = { result: r.status === 0 ? 'PASS' : 'FAIL', at: new Date().toISOString(), fp, name, by: 'stop-hook', items: [{ name: 'quick-check.mjs', pass: r.status === 0, why: `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-20).join('\n') }] };
      fs.writeFileSync(LAST, JSON.stringify(last, null, 1));
    }
  }
}
if (last.result === 'PASS') { fs.rmSync(FAILS, { force: true }); process.exit(0); }

const f = readJson(FAILS, {});
const n = f.fp === fp ? f.n + 1 : 1;
fs.writeFileSync(FAILS, JSON.stringify({ fp, n }));
const report = (last.items || []).filter((i) => !i.pass).map((i) => `FAIL ${i.name}\n    ${String(i.why || '').replace(/\n/g, '\n    ')}`).join('\n').slice(0, 4000);
if (n > 3) {
  console.log(JSON.stringify({ systemMessage: `${name} gate still FAILS after 3 tries (version ${fp}). The chat stopped; it must tell Tyler what is broken.` }));
  process.exit(0);
}
console.log(JSON.stringify({
  decision: 'block',
  reason: `${name} gate FAILED (try ${n} of 3; version ${fp}). Fix it before you finish; never weaken a check to make it pass unless the check itself is wrong (then say so to Tyler).\n${report}\nRerun: node scripts/quick-check.mjs`,
}));
