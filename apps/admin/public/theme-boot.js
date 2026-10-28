// The in-app theme before the first paint (docs/06 §2.2, sweep finding 16): a blocking same-origin script, because the policy allows no
// inline script. It mirrors src/lib/theme.ts (key "ta-admin-theme"; "system" sets no attribute), which applies it again once the app runs.
try {
  const theme = localStorage.getItem("ta-admin-theme");
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
} catch {
  // Storage unavailable (private mode): the page follows the system until the app runs.
}
