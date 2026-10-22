type Env = Record<string, string | undefined>;
export function dbUrlOf(env: Env): string;
export function isLocalDb(env: Env): boolean;
export function uploadsRootFor(url: string, cwd?: string): string | null;
export const KEY_PATTERN: RegExp;
export function keyPath(root: string, key: string): string;
