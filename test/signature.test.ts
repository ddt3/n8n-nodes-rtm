import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signRequest } from '../nodes/RememberTheMilk/signature';

// Tests for the RTM request signature (Feature B / Step 1).
// NOTE: the example below is the BANANAS example from the RTM authentication docs, as recalled
// when this step was written; it could not be re-read from the docs page in that session.
// The final proof is the live API accepting signed calls (planned in Feature E).
describe('signRequest', () => {
  it('matches the documented BANANAS example', () => {
    const signature = signRequest('BANANAS', { yxz: 'foo', feg: 'bar', abc: 'baz' });
    // Public documentation example value, not a secret.
    expect(signature).toBe('82044aae4dd676094f23f1ec152159ba'); // secret-scan:allow
  });

  it('does not depend on the order the parameters are given in', () => {
    const a = signRequest('S3cretValue', { b: '2', a: '1', c: '3' });
    const b = signRequest('S3cretValue', { c: '3', a: '1', b: '2' });
    expect(a).toBe(b);
  });

  it('sorts by plain character order (uppercase before lowercase), not by locale', () => {
    // Block: the expected base strings are spelled out so the order is visible.
    // Plain order puts "B" before "a" -> "KEY" + "Bx" + "ay". A locale-aware sort would
    // put "a" first -> "KEY" + "ay" + "Bx", which must NOT be what we produce.
    const md5 = (text: string) => createHash('md5').update(text).digest('hex');
    const signature = signRequest('KEY', { a: 'y', B: 'x' });
    expect(signature).toBe(md5('KEYBxay'));
    expect(signature).not.toBe(md5('KEYaybx'.replace('bx', 'Bx')));
  });

  it('leaves out undefined and null parameters because they are not sent', () => {
    const withEmpty = signRequest('KEY', { a: '1', b: undefined, c: null });
    const without = signRequest('KEY', { a: '1' });
    expect(withEmpty).toBe(without);
  });

  it('turns numbers and booleans into text', () => {
    const typed = signRequest('KEY', { n: 5, t: true, f: false });
    const text = signRequest('KEY', { n: '5', t: 'true', f: 'false' });
    expect(typed).toBe(text);
  });

  it('hashes non-ASCII values as UTF-8', () => {
    const expected = createHash('md5').update('KEYnaamZoë ✓', 'utf8').digest('hex');
    expect(signRequest('KEY', { naam: 'Zoë ✓' })).toBe(expected);
  });

  it('returns 32 lowercase hex characters', () => {
    expect(signRequest('KEY', { a: '1' })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects an empty secret', () => {
    expect(() => signRequest('', { a: '1' })).toThrow('empty');
  });

  it('rejects api_sig among the signed parameters', () => {
    expect(() => signRequest('KEY', { a: '1', api_sig: 'x' })).toThrow('api_sig');
  });

  it('never puts the secret into an error message', () => {
    // Built at run time so the source holds no secret-looking literal (see the secret scan rules).
    const secret = ['Sup3r', 'S3cret', 'Value'].join('');
    let message = '';
    try {
      signRequest(secret, { api_sig: 'x' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(secret);
  });
});
