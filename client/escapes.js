/* ── Pure shell-escaping helpers for WSL command construction ──
 * Values are interpolated inside double quotes in a bash command string
 * (`cd "<dir>" && opencode run ... "<msg>"`). Escape the metacharacters
 * that bash would interpret inside double quotes plus backslash itself.
 */

// Full escaping for message-like values (also guards `!` history expansion).
export function escapeArg(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!');
}

// Directory escaping (same as escapeArg but without `!`, preserving the
// original dir-escaping behavior).
export function escapeDir(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}
