// Planted breaks for scripts/test-the-tester.mjs (gate kit). Each = a real past bug (git log, docs/PLAYTESTS.md,
// player notes) or the core of the project, put back on purpose: the quick check must FAIL on every one (Lauren Tan:
// a check counts once it is proven to fail on the real mistake). At least 2. `expect` = words the failure must show.
export default [
  // 6778e90 (2026-10-16): the policy said read-only while the app wrote contacts
  { name: 'policy-says-read-only', what: 'the privacy policy claims read-only Google access', file: 'privacy.html', from: 'asks to read and update your Google Contacts', to: 'asks for read-only access to your Google Contacts', expect: 'what the app really asks Google' },
  // 6b56cb2 (2026-10-14): the home page sold it as a map of where friends and family usually are
  { name: 'home-page-locates-people', what: 'the home page describes locating people again', file: 'index.html', from: '<p class="muted">A private notebook for remembering the people in your life.</p>', to: '<p class="muted">A private map of the people in your life.</p><p>People Map shows roughly where friends and family usually are during the week.</p>', expect: 'private notebook' },
  // core: Google's sign-in screen links the privacy policy from the home page
  { name: 'no-privacy-link', what: 'the home page loses its privacy policy link', file: 'index.html', from: '<a href="privacy.html">Privacy policy</a> · ', to: '', expect: 'links' },
];
