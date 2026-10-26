import { createHash } from 'node:crypto';

/** Request parameters as sent to the RTM API. `undefined` and `null` values are not sent. */
export type RtmParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Computes the Remember The Milk request signature (`api_sig`).
 *
 * Offers: the exact signing algorithm from the RTM authentication docs:
 *   1. sort the parameters by name,
 *   2. concatenate the shared secret, then every name immediately followed by its value
 *      (no separators),
 *   3. return the MD5 hash of that string as lowercase hex.
 *
 * The secret is only used as hash input; it is never returned and never put into an error message.
 *
 * @param sharedSecret Your RTM shared secret.
 * @param params       All request parameters except `api_sig` itself (including `api_key`, `method`
 *                     and `auth_token` where they apply).
 * @returns The 32-character lowercase hex signature to send as `api_sig`.
 * @throws Error when the secret is empty or when `api_sig` is among the parameters.
 */
export function signRequest(sharedSecret: string, params: RtmParams): string {
  // Block: reject input that would silently produce a wrong or meaningless signature.
  if (!sharedSecret) {
    throw new Error('RTM shared secret is empty');
  }
  if (Object.prototype.hasOwnProperty.call(params, 'api_sig')) {
    throw new Error('api_sig must not be part of the parameters that are signed');
  }

  // Block: keep only parameters that are actually sent, sorted by name in plain code-unit
  // order (not locale order), exactly as the RTM docs describe.
  const names = Object.keys(params)
    .filter((name) => params[name] !== undefined && params[name] !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Block: secret + name1 + value1 + name2 + value2 ... then MD5 (UTF-8) as hex.
  const base = names.reduce((text, name) => text + name + String(params[name]), sharedSecret);
  return createHash('md5').update(base, 'utf8').digest('hex');
}
