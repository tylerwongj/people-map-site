// Gate kit library (shared-ai-context/gate-kit, copied into each project as scripts/gate/kit.mjs). Don't edit the
// copy: change the kit, then `node C:/Users/tyler/Documents/shared-ai-context/gate-kit/install.mjs --update`.
// A gate (Lauren Tan's rung 3) = scripts/quick-check.mjs runs the REAL app headless + muted and prints PASS/FAIL per
// item; the Stop hook (scripts/hooks/stop-check.mjs) blocks a chat from finishing on FAIL; scripts/test-the-tester.mjs
// proves each check fails when a real past bug is put back.
import { spawn, spawnSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GATE_KIT_VERSION = 2;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LAST = path.join(ROOT, '.proof', 'gate-last.json');
export const PLANTED = path.join(ROOT, '.local', 'planted-break.json');
export const SHARED = path.join(os.homedir(), 'Documents', 'shared-ai-context');
export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// One code for "the project exactly as it is on disk": every file git sees (committed or new, not ignored) minus
// notes that can't change behaviour (.md/.txt, docs/, .claude/, proof). Any source change = a new code, so an old
// PASS no longer counts. Files over 2 MB (art, builds) count by size + time, not content.
const NOT_SOURCE = (f) => /\.(md|txt)$/i.test(f) || /^(docs|\.claude|\.proof|\.local|node_modules)\//.test(f);
const sourceFiles = (root) => {
  try { return execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((x) => x && !NOT_SOURCE(x)).sort(); } catch { return []; }
};
export function fingerprint(root = ROOT) {
  const h = createHash('sha1');
  for (const f of sourceFiles(root)) {
    let st;
    try { st = fs.statSync(path.join(root, f)); } catch { continue; } // deleted, not yet committed
    if (!st.isFile()) continue;
    h.update(f + '\0');
    h.update(st.size > 2e6 ? `${st.size}:${st.mtimeMs}` : fs.readFileSync(path.join(root, f)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

const tail = (text) => {
  const lines = String(text || '').trim().split(/\r?\n/);
  const hits = lines.filter((l) => /FAIL|✗|✖|×|\berror\b|Error|expected|assert/i.test(l)).slice(0, 8);
  return (hits.length ? hits : lines.slice(-8)).join('\n').slice(0, 1200);
};

// Run the gate's items in order and print PASS/FAIL per item. An item = { name, run } where run is a shell command
// (passes on exit 0; or { name, cmd: () => 'command' } when it needs a url an earlier item made) or a function returning true/undefined (pass), a string (fail: why), an array of problems
// (pass when empty) or { pass, why }. Writes .proof/gate-last.json (read by the Stop hook, gates.mjs and Mission
// Control's Checks tab). Returns the exit code: `process.exitCode = await runGate([...])`.
export async function runGate(items, { name = path.basename(ROOT), after } = {}) {
  const t0 = Date.now();
  const fp = fingerprint();
  const results = [];
  const say = (r) => console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.pass ? '' : `\n    ${String(r.why || 'failed').replace(/\n/g, '\n    ')}`}`);
  if (fs.existsSync(PLANTED) && !process.env.PLANTED_BY_TESTER) {
    const left = readJson(PLANTED, {});
    const r = { name: 'no planted break left behind', pass: false, why: `${left.file} still has a break the tester planted: run node scripts/test-the-tester.mjs (it puts the file back first)` };
    results.push(r); say(r);
  }
  // Every gate, free: a backslash sent through a shell (node -e, a heredoc) becomes an invisible control character
  // in code (\b turned into a backspace on 2026-10-16 and again 2026-10-22). Write code with Edit/Write instead.
  const stray = sourceFiles(ROOT).filter((f) => /\.(m?[jt]sx?|cjs|css|html?|json|py|cs|gd|svelte|vue)$/i.test(f)).filter((f) => {
    try { const b = fs.readFileSync(path.join(ROOT, f)); return b.length < 2e6 && b.some((c) => c < 32 && c !== 9 && c !== 10 && c !== 13); } catch { return false; }
  });
  { const r = { name: 'no invisible control characters in code', pass: !stray.length, why: `${stray.slice(0, 5).join(', ')}: a backslash went through a shell (\\b became a backspace). Rewrite those lines with the Edit tool.` }; results.push(r); if (!r.pass) say(r); }
  try {
    for (const it of items.filter(Boolean)) {
      const s = Date.now();
      let pass = false, why = '';
      try {
        const cmd = typeof it.run === 'string' ? it.run : typeof it.cmd === 'function' ? it.cmd() : it.cmd;
        if (cmd) {
          const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 1 << 27, timeout: (it.timeoutSec || 900) * 1000 });
          pass = r.status === 0;
          if (!pass) why = r.error ? `${r.error.message}` : tail(`${r.stdout}\n${r.stderr}`);
        } else {
          const v = await it.run();
          if (v === true || v === undefined) pass = true;
          else if (Array.isArray(v)) { pass = v.length === 0; why = v.slice(0, 8).join('\n'); }
          else if (typeof v === 'string') why = v;
          else if (v && typeof v === 'object') { pass = !!v.pass; why = v.why || ''; }
        }
      } catch (e) { why = String(e?.stack || e).split('\n').slice(0, 3).join('\n'); }
      const r = { name: it.name, pass, why, sec: Math.round((Date.now() - s) / 100) / 10 };
      results.push(r); say(r);
    }
  } finally { try { await after?.(); } catch { /* cleanup is best effort */ } }
  const failed = results.filter((r) => !r.pass);
  const took = Math.round((Date.now() - t0) / 1000);
  console.log(`\n${failed.length ? `FAIL  ${failed.length} of ${results.length} failed` : `PASS  all ${results.length} passed`} (${took} s, ${name} version ${fp})`);
  fs.mkdirSync(path.dirname(LAST), { recursive: true });
  fs.writeFileSync(LAST, JSON.stringify({
    result: failed.length ? 'FAIL' : 'PASS', at: new Date().toISOString(), took, fp, name, kit: GATE_KIT_VERSION,
    by: process.env.GATE_BY || 'manual', items: results.map((r) => ({ name: r.name, pass: r.pass, why: String(r.why || '').slice(0, 400), sec: r.sec })),
  }, null, 1));
  return failed.length ? 1 : 0;
}

// An item that FAILS until someone writes the real check (a fresh gate never passes empty).
export const todo = (what) => ({ name: what, run: () => `not written yet: replace this todo in scripts/quick-check.mjs with a real check (from this project's real past bugs)` });

const pkg = () => readJson(path.join(ROOT, 'package.json'), {});
// `npm test` when package.json has a real one; null otherwise (runGate skips nulls).
export function npmTest() {
  const t = pkg().scripts?.test;
  return t && !/no test specified/.test(t) ? { name: 'tests (npm test)', run: 'npm test --silent' } : null;
}
export const typecheck = () => (fs.existsSync(path.join(ROOT, 'tsconfig.json')) ? { name: 'typecheck', run: 'npx tsc --noEmit' } : null);

export function freePort() {
  return new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}

// Start the app on a spare port (never the live copy's port): `{port}` in cmd and env values is replaced, and PORT is
// set too. Ready = the url answers below 500. Returns { url, port, stop }. Only this process tree is stopped.
export async function startServer({ cmd, port, env = {}, path: p = '/', timeoutMs = 60000, cwd = ROOT }) {
  port = port || await freePort();
  const line = cmd.replace(/\{port\}/g, String(port));
  const own = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v).replace(/\{port\}/g, String(port))]));
  const child = spawn(line, { cwd, shell: true, env: { ...process.env, PORT: String(port), BROWSER: 'none', ...own }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-4000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
  const stop = async () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } }
  };
  const url = `http://127.0.0.1:${port}${p}`;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`the app stopped while starting (${line}):\n${log.slice(-800)}`);
    try { const r = await fetch(url); if (r.status < 500) return { url, port, stop, log: () => log }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  throw new Error(`nothing answered on ${url} within ${Math.round(timeoutMs / 1000)} s (${line}). Does the app read PORT or {port}?\n${log.slice(-600)}`);
}

// A tiny static file server for plain HTML games/sites (no build step). Returns { url, port, stop }.
export async function serveStatic(dir = ROOT, { port } = {}) {
  const http = await import('node:http');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(path.resolve(dir)) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  port = port || await freePort();
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${port}/`, port, stop: () => new Promise((ok) => srv.close(ok)) };
}

// Headless, muted Chromium from the project's own playwright(-core), else game-hub's. CHROME (the Mac sets it) wins.
export async function browser() {
  let chromium;
  for (const base of [ROOT, path.join(os.homedir(), 'Documents', 'game-hub')]) {
    const req = createRequire(path.join(base, 'noop.js'));
    for (const name of ['playwright-core', 'playwright']) {
      try { const m = await import(pathToFileURL(req.resolve(name)).href); chromium = m.chromium || m.default?.chromium; } catch { /* next */ }
      if (chromium) break;
    }
    if (chromium) break;
  }
  if (!chromium) throw new Error('no playwright-core in this project or game-hub: npm i -D playwright-core');
  const args = ['--mute-audio', '--autoplay-policy=user-gesture-required'];
  if (process.env.CHROME) return chromium.launch({ headless: true, executablePath: process.env.CHROME, args });
  try { return await chromium.launch({ headless: true, args }); } catch { return chromium.launch({ headless: true, channel: 'chrome', args }); }
}

// The shared UI audit (UI-MISTAKES.md: sideways scroll, spills, squashed text, console errors...). Returns problems.
export async function uiAudit(url, opts = {}) {
  const f = path.join(SHARED, 'tools', 'ui-audit.mjs');
  if (!fs.existsSync(f)) return [`the shared UI audit is missing on this computer (${f})`];
  const { runAudit } = await import(pathToFileURL(f).href);
  const b = opts.browser || await browser();
  try { return await runAudit(url, { widths: [1440, 780, 375], ...opts, browser: b }); } finally { if (!opts.browser) await b.close(); }
}

// Open a page, wait for `wait` (a selector), let it run `settleMs`, and report page/console errors. Returns problems.
export async function pageCheck(url, { wait = 'body', settleMs = 3000, viewport = { width: 1280, height: 800 }, browser: b0 } = {}) {
  const b = b0 || await browser();
  const problems = [];
  try {
    const page = await b.newPage({ viewport });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text().slice(0, 200)}`); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(wait, { state: 'attached', timeout: 15000 }).catch(() => problems.push(`never showed ${wait}`));
    await page.waitForTimeout(settleMs);
    await page.close();
  } finally { if (!b0) await b.close(); }
  return [...new Set(problems)];
}

// The game hub's every-game checks for one local game (pop-ups, no auto-pause, phone fit, shared bar...).
// `url` may be a function, for a server an earlier item started.
export function everyGame(url, slug) {
  const tool = path.join(os.homedir(), 'Documents', 'game-hub', 'tools', 'every-game-checks.mjs');
  return {
    name: 'every-game checks (game hub)',
    run: () => {
      if (!fs.existsSync(tool)) return `game-hub is missing on this computer (${tool})`;
      const r = spawnSync(process.execPath, [tool, '--url', typeof url === 'function' ? url() : url, '--as', slug], { cwd: path.dirname(path.dirname(tool)), encoding: 'utf8', maxBuffer: 1 << 27, timeout: 600000 });
      return r.status === 0 || tail(`${r.stdout}\n${r.stderr}`);
    },
  };
}
