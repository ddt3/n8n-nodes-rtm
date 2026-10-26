import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOW_MARKER, scanText } from '../scripts/secret-scan.mjs';

// Tests for the secret safeguards (Feature A / Step 2).
// Every fake secret is BUILT at run time, so this file itself contains no secret-looking literal.
const fakeHex32 = 'a1b2c3d4'.repeat(4);
const fakeGithubToken = 'ghp_' + 'A1b2'.repeat(9);
const fakePrivateKeyHeader = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
// This file is an ES module (it imports an .mjs script), so __dirname is not available.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('scanText: detects planted fake secrets', () => {
  it('flags a secret-like name assigned a credential-shaped value', () => {
    const findings = scanText(`const apiKey = "${fakeHex32}";`, 'a.ts');
    expect(findings.map((f) => f.rule)).toContain('named-secret-assignment');
  });

  it('flags a bare 32-character hex string', () => {
    expect(scanText(`x ${fakeHex32} y`).map((f) => f.rule)).toContain('hex-string-32-or-more');
  });

  it('flags a GitHub token shape', () => {
    expect(scanText(fakeGithubToken).map((f) => f.rule)).toContain('github-token');
  });

  it('flags a private key header', () => {
    expect(scanText(fakePrivateKeyHeader).map((f) => f.rule)).toContain('private-key-header');
  });

  it('flags a secret passed in a URL query string', () => {
    expect(scanText('https://example.test/rest/?api_key=' + 'Zx9Yw8Vu7T').map((f) => f.rule)).toContain(
      'secret-in-url-query',
    );
  });

  it('reports the line number', () => {
    const findings = scanText(`ok\nok\nconst secret = "${fakeHex32}"`);
    expect(findings.some((f) => f.line === 3)).toBe(true);
  });
});

describe('scanText: leaves normal code alone', () => {
  it('does not flag identifiers or plain words', () => {
    const code = [
      'apiKey: credentials.apiKey,',
      'const sharedSecret = getSharedSecret();',
      '// the auth token is stored in n8n credentials',
      "token: 'abc',",
    ].join('\n');
    expect(scanText(code)).toEqual([]);
  });

  it('honours the allow marker on a deliberate fake', () => {
    expect(scanText(`const secret = "${fakeHex32}" // ${ALLOW_MARKER}`)).toEqual([]);
  });

  it('never returns the matched value', () => {
    const json = JSON.stringify(scanText(`secret = "${fakeHex32}"`));
    expect(json).not.toContain(fakeHex32);
  });
});

describe('pre-commit hook: blocks a planted fake secret end to end', () => {
  it('rejects a commit containing a secret and accepts it once removed', () => {
    // Block: build a throw-away git repo that uses this repo's scanner and hook.
    const dir = mkdtempSync(join(tmpdir(), 'rtm-hook-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      mkdirSync(join(dir, '.githooks'));
      cpSync(join(repoRoot, 'scripts/secret-scan.mjs'), join(dir, 'scripts/secret-scan.mjs'));
      cpSync(join(repoRoot, '.githooks/pre-commit'), join(dir, '.githooks/pre-commit'));
      chmodSync(join(dir, '.githooks/pre-commit'), 0o755); // hooks must be executable
      const git = (...args: string[]) =>
        spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      git('init', '-q');
      git('config', 'user.email', 'test@example.test');
      git('config', 'user.name', 'Test');
      git('config', 'core.hooksPath', '.githooks');

      // Block: a file with a planted fake secret must be rejected, and not echoed back.
      writeFileSync(join(dir, 'config.ts'), `export const secret = "${fakeHex32}";\n`);
      git('add', 'config.ts');
      const blocked = git('commit', '-m', 'should be blocked');
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain('config.ts:1');
      expect(blocked.stdout + blocked.stderr).not.toContain(fakeHex32);

      // Block: the same file without the secret commits fine.
      writeFileSync(join(dir, 'config.ts'), 'export const secret = process.env.NOT_A_REAL_VALUE;\n');
      git('add', 'config.ts');
      const accepted = git('commit', '-m', 'clean');
      expect(accepted.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('repository hygiene', () => {
  it('ignores env and key files via .gitignore', () => {
    for (const name of ['.env', '.env.local', 'rtm.key', 'secrets/token.txt']) {
      // git check-ignore exits 0 when the path is ignored (throws otherwise).
      expect(() => execFileSync('git', ['check-ignore', '-q', name], { cwd: repoRoot })).not.toThrow();
    }
  });

  it('has a clean working tree (scan --all finds nothing)', () => {
    const result = spawnSync('node', ['scripts/secret-scan.mjs', '--all'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });
});
