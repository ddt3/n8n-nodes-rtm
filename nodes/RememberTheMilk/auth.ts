import { rtmCall, RtmError, type RtmCallOptions, type RtmCredentials } from './client';
import { signRequest } from './signature';

/** Where the user approves access. */
export const RTM_AUTH_URL = 'https://www.rememberthemilk.com/services/auth/';

/** Permission levels RTM knows, from least to most. */
export type RtmPermission = 'read' | 'write' | 'delete';
const PERMISSIONS: readonly string[] = ['read', 'write', 'delete'];

/** Result of a successful authorisation. */
export interface RtmAuthResult {
  token: string;
  perms: string;
  username: string;
}

/** Throws unless `perms` is one of read, write, delete. */
function assertPermission(perms: string): asserts perms is RtmPermission {
  if (!PERMISSIONS.includes(perms)) {
    throw new RtmError('usage', `Permission must be one of: ${PERMISSIONS.join(', ')}`);
  }
}

/**
 * Step 1 of authorisation: asks RTM for a frob (a short-lived one-time id).
 * Uses no auth token, so any token in `creds` is ignored.
 */
export async function getFrob(creds: RtmCredentials, options: RtmCallOptions = {}): Promise<string> {
  const rsp = await rtmCall({ ...creds, authToken: undefined }, 'rtm.auth.getFrob', {}, options);
  if (typeof rsp.frob !== 'string' || rsp.frob === '') throw new RtmError('parse', 'Remember The Milk returned no frob');
  return rsp.frob;
}

/**
 * Step 2: builds the signed URL the user opens to approve access.
 * The URL holds the API key and a signature, never the shared secret.
 */
export function buildAuthUrl(creds: RtmCredentials, frob: string, perms: string): string {
  assertPermission(perms);
  const params = { api_key: creds.apiKey, perms, frob };
  const query = new URLSearchParams({ ...params, api_sig: signRequest(creds.sharedSecret, params) });
  return `${RTM_AUTH_URL}?${query.toString()}`;
}

/**
 * Step 3: after the user approved, trades the frob for the long-lived auth token.
 */
export async function getToken(creds: RtmCredentials, frob: string, options: RtmCallOptions = {}): Promise<RtmAuthResult> {
  const rsp = await rtmCall({ ...creds, authToken: undefined }, 'rtm.auth.getToken', { frob }, options);
  const auth = rsp.auth as { token?: unknown; perms?: unknown; user?: { username?: unknown } } | undefined;
  if (!auth || typeof auth.token !== 'string' || auth.token === '') {
    throw new RtmError('parse', 'Remember The Milk returned no auth token');
  }
  return { token: auth.token, perms: String(auth.perms ?? ''), username: String(auth.user?.username ?? '') };
}

/** Where the command line tool writes text and gets its settings from (injectable for tests). */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
  options?: RtmCallOptions;
}

/**
 * Command line front end for the one-time authorisation.
 *
 *   rtm-authorize start [read|write|delete]   prints the approval URL and the frob
 *   rtm-authorize finish <frob>               prints the auth token
 *
 * The API key and shared secret come from the environment (RTM_API_KEY, RTM_SHARED_SECRET),
 * never from arguments, so they do not end up in shell history.
 *
 * @returns The process exit code (0 on success).
 */
export async function runAuthorizeCli(argv: string[], io: CliIo): Promise<number> {
  const [command, arg] = argv;
  const apiKey = io.env.RTM_API_KEY;
  const sharedSecret = io.env.RTM_SHARED_SECRET;
  if (!apiKey || !sharedSecret) {
    io.err('Set RTM_API_KEY and RTM_SHARED_SECRET in the environment.');
    return 2;
  }
  const creds: RtmCredentials = { apiKey, sharedSecret };
  try {
    if (command === 'start') {
      const frob = await getFrob(creds, io.options);
      io.out(`Open this URL, approve access, then run: rtm-authorize finish ${frob}`);
      io.out(buildAuthUrl(creds, frob, arg ?? 'delete'));
      return 0;
    }
    if (command === 'finish' && arg) {
      const result = await getToken(creds, arg, io.options);
      io.out(`Authorised as ${result.username} with permission "${result.perms}".`);
      io.out('Put this token in the n8n credential field "Auth Token" (and nowhere else):');
      io.out(result.token);
      return 0;
    }
    io.err('Usage: rtm-authorize start [read|write|delete] | rtm-authorize finish <frob>');
    return 2;
  } catch (error) {
    io.err(error instanceof RtmError ? error.message : 'Unexpected error');
    return 1;
  }
}
