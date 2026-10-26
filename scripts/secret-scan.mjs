// @ts-check
/**
 * secret-scan: blocks secret-looking strings from entering this PUBLIC repository.
 *
 * Offers:
 *   - scanText(text, file): pure function, returns findings for one text.
 *   - CLI: `node scripts/secret-scan.mjs --staged` (pre-commit) or `--all` (whole tree).
 *
 * Design rules:
 *   - A finding reports file, line and rule name ONLY. The matched value is never
 *     printed or returned, so logs and CI output cannot leak it.
 *   - A line containing the marker `secret-scan:allow` is skipped (for deliberate fakes).
 *   - Exit code 1 when anything is found, 0 otherwise.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Marker that exempts a single line from scanning. */
export const ALLOW_MARKER = 'secret-scan:allow';

/** Files that legitimately contain long hashes and are skipped. */
const SKIP_FILES = new Set(['package-lock.json']);

/** Largest file (bytes) that is scanned; bigger files are skipped as non-source. */
const MAX_BYTES = 1_000_000;

/**
 * Decides whether a value assigned to a secret-like name looks like a real secret
 * (and not an identifier such as `credentials.apiKey`).
 * @param {string} value The text after the `=` or `:`.
 * @returns {boolean} True when it has the shape of a credential value.
 */
function looksLikeSecretValue(value) {
  return value.length >= 16 && /\d/.test(value) && /[A-Za-z]/.test(value);
}

/**
 * Pattern rules that match on their own, regardless of the surrounding name.
 * Each rule only needs a name and a regex; values are never reported.
 * @type {{ name: string, regex: RegExp }[]}
 */
const PATTERN_RULES = [
  { name: 'hex-string-32-or-more', regex: /\b[a-f0-9]{32,}\b/i },
  { name: 'github-token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'private-key-header', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'secret-in-url-query', regex: /[?&](?:api_key|auth_token|api_sig|frob|token|secret)=[A-Za-z0-9]{8,}/i },
];

/** Matches `<secret-like name> = <value>` or `<name>: <value>` (value captured). */
const NAMED_VALUE_REGEX =
  /\b(?:api[_-]?key|api[_-]?secret|shared[_-]?secret|client[_-]?secret|secret|auth[_-]?token|access[_-]?token|token|frob|password|passwd|api[_-]?sig)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=]{12,})/gi;

/**
 * Scans one text and reports where secret-like strings appear.
 * @param {string} text File content.
 * @param {string} [file] Name used in the findings.
 * @returns {{ file: string, line: number, rule: string }[]} Findings (no values).
 */
export function scanText(text, file = '<text>') {
  /** @type {{ file: string, line: number, rule: string }[]} */
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    // Block: skip lines that carry the explicit allow marker.
    if (lineText.includes(ALLOW_MARKER)) return;
    const line = index + 1;

    // Block: standalone patterns (hashes, tokens, key headers, URL query secrets).
    for (const rule of PATTERN_RULES) {
      if (rule.regex.test(lineText)) findings.push({ file, line, rule: rule.name });
    }

    // Block: a secret-like NAME assigned a secret-like VALUE.
    for (const match of lineText.matchAll(NAMED_VALUE_REGEX)) {
      if (looksLikeSecretValue(match[1])) findings.push({ file, line, rule: 'named-secret-assignment' });
    }
  });

  return findings;
}

/**
 * Lists the files to scan for a mode.
 * @param {'staged' | 'all'} mode `staged` = index content, `all` = tracked + untracked-not-ignored.
 * @returns {string[]} Repository-relative paths.
 */
function listFiles(mode) {
  const args =
    mode === 'staged'
      ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
      : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

/**
 * Reads the content to scan: the staged blob for `staged`, the working file for `all`.
 * @param {string} path Repository-relative path.
 * @param {'staged' | 'all'} mode Scan mode.
 * @returns {string | null} Text, or null when the file is binary, too large or unreadable.
 */
function readContent(path, mode) {
  try {
    const buffer =
      mode === 'staged'
        ? execFileSync('git', ['show', `:${path}`], { maxBuffer: MAX_BYTES * 2 })
        : (statSync(path).size > MAX_BYTES ? null : readFileSync(path));
    if (!buffer || buffer.length > MAX_BYTES || buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * CLI entry: scans the chosen file set, prints findings, sets the exit code.
 * @param {string[]} argv Command-line arguments after the script name.
 * @returns {number} Exit code (0 clean, 1 findings, 2 usage error).
 */
export function main(argv) {
  const mode = argv.includes('--staged') ? 'staged' : argv.includes('--all') ? 'all' : null;
  if (!mode) {
    console.error('usage: node scripts/secret-scan.mjs --staged | --all');
    return 2;
  }

  // Block: collect findings across every scannable file.
  const findings = [];
  for (const path of listFiles(mode)) {
    if (SKIP_FILES.has(path)) continue;
    const content = readContent(path, mode);
    if (content !== null) findings.push(...scanText(content, path));
  }

  // Block: report without ever printing a matched value.
  if (findings.length === 0) {
    console.log(`secret-scan (${mode}): clean`);
    return 0;
  }
  console.error(`secret-scan (${mode}): ${findings.length} possible secret(s) found - values are not shown:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  console.error(`If a line is a deliberate fake, add the marker "${ALLOW_MARKER}" on that line.`);
  return 1;
}

// Run only when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
