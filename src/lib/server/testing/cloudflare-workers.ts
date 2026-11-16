/**
 * `cloudflare:workers` for the `server` vitest project, aliased in vite.config.ts.
 * The adapter's own dev stub throws on `env` without a platform proxy, which a
 * spec never starts. No bindings and a no-op `waitUntil`; a spec that needs
 * either mocks this module with `vi.mock('cloudflare:workers', ...)`.
 */
export const env = {} as Cloudflare.Env;

export function waitUntil(_promise: Promise<unknown>): void {}
