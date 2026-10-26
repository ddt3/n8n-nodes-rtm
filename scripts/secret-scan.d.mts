// Type declarations for scripts/secret-scan.mjs so the TypeScript tests can import it.
export const ALLOW_MARKER: string;
export function scanText(text: string, file?: string): { file: string; line: number; rule: string }[];
export function main(argv: string[]): number;
