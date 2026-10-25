// People Map site quick check (~1 min; gate kit). These three pages are People Map's public home, privacy policy and
// terms (GitHub Pages; Google's sign-in screen links to them), so the privacy policy must say exactly what the app
// asks Google for. The gate serves the pages on a spare port, checks the policy against the app's real Google
// permissions (Documents/people-map/lib/google.mjs), the links, the wording, then the shared UI audit. Rows: CHECKS.md.
//   node scripts/quick-check.mjs   -> PASS/FAIL per item, exit 0 = all passed
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGate, serveStatic, uiAudit, ROOT } from './gate/kit.mjs';

const PAGES = ['index.html', 'privacy.html', 'terms.html'];
const text = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const APP_GOOGLE = path.join(os.homedir(), 'Documents', 'people-map', 'lib', 'google.mjs');

// 6778e90 (2026-10-16): the app started writing contacts while the policy still said read-only.
function policyMatchesApp() {
  if (!fs.existsSync(APP_GOOGLE)) return `People Map's Google code is missing on this computer (${APP_GOOGLE}): can't check the policy against it`;
  const scopes = (fs.readFileSync(APP_GOOGLE, 'utf8').match(/const SCOPE = '([^']+)'/) || [])[1]?.split(' ') || [];
  if (!scopes.length) return 'could not read SCOPE from people-map/lib/google.mjs';
  const p = text('privacy.html');
  const problems = [];
  const has = (s) => scopes.includes(`https://www.googleapis.com/auth/${s}`);
  if (has('contacts') && !/read and update your Google Contacts/.test(p)) problems.push('the app can change Google Contacts; the policy must say "read and update your Google Contacts"');
  if ((has('contacts') || has('calendar.events')) && !/never deletes/.test(p)) problems.push('the policy must say the app never deletes anything');
  if (has('calendar.events') && !/change events you edit in People Map/.test(p)) problems.push('the app can edit Google Calendar events; the policy must say it may "change events you edit in People Map"');
  if (/read-only/i.test(p) && (has('contacts') || has('calendar.events'))) problems.push('the policy still says "read-only" but the app can write');
  if (!/Limited Use/.test(p)) problems.push('the Google API Services User Data Policy / Limited Use statement is missing');
  return problems;
}

// 6b56cb2 (2026-10-14): the home page sold it as a map of where friends and family are; it is a private notebook.
function wording() {
  const problems = [];
  if (!/private notebook/.test(text('index.html'))) problems.push('home page no longer calls People Map a private notebook');
  for (const f of PAGES) if (/where (your )?(friends|family|people)[^.]{0,30}\bare\b|locations it shows|tracking/i.test(text(f))) problems.push(`${f} describes locating people ("where friends are", "tracking")`);
  return problems;
}

function links() {
  const problems = [];
  for (const f of PAGES) for (const [, href] of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/href="([^"]+)"/g)) {
    if (!/^(https?:|mailto:|#)/.test(href) && !fs.existsSync(path.join(ROOT, href))) problems.push(`${f} links to a missing ${href}`);
  }
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const need of ['privacy.html', 'terms.html']) if (!home.includes(`href="${need}"`)) problems.push(`home page has no link to ${need} (Google's sign-in screen needs both)`);
  if (!/mailto:/.test(fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8'))) problems.push('privacy page has no contact address');
  return problems;
}

let app;
process.exitCode = await runGate([
  { name: 'privacy policy says what the app really asks Google for', run: policyMatchesApp },
  { name: 'pages call it a private notebook, never a people locator', run: wording },
  { name: 'links: home -> privacy + terms, no broken links, a contact', run: links },
  { name: 'pages are served on a spare port', run: async () => { app = await serveStatic(); } },
  { name: 'pages pass the UI audit (1440 / 780 / 375)', run: async () => (await Promise.all(PAGES.map((f) => uiAudit(app.url + f).then((p) => p.map((x) => `${f} ${x}`))))).flat() },
], { after: () => app?.stop() });
