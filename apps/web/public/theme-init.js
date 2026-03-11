/* eslint-env browser */
// Early-boot theme initialization — runs before React is loaded.
// Cannot reuse apps/web/src/client/lib/theme.ts here because that module depends
// on the Electron `accomplish` bridge (getAccomplish / onThemeChange) which is not
// yet initialised at HTML-parse time.
(function () {
  var t = 'system';
  try {
    t = localStorage.getItem('theme') || 'system';
  } catch (_e) {
    // localStorage may be unavailable in sandboxed environments; fall back to system
  }
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = t === 'dark' || (t === 'system' && prefersDark);
  if (isDark) {
    document.documentElement.classList.add('dark');
  }
})();
