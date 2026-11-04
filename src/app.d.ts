import type { User, Session } from 'better-auth/minimal';
import type { Position } from '#lib/config.js';
import type { CommitteeGrant } from '#lib/server/capability/capability-grants.js';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/**
	 * The Sentry release name for this build — the same string vite.config.ts
	 * gives the Sentry vite plugin. Replaced at build time by `define`, so it is
	 * a literal in the bundle, not a lookup; `null` when none could be resolved.
	 */
	const __SENTRY_RELEASE_NAME__: string | null;

	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
			/**
			 * The caller's authorization positions, memoised for this request.
			 *
			 * Written and read only by `#lib/server/authorization.js`; hooks.server.ts
			 * deliberately leaves it undefined so requests that never check a
			 * capability never pay for the read. A promise rather than an array so
			 * that concurrent guards inside one `Promise.all` share a single read
			 * instead of each starting their own.
			 */
			positions?: Promise<Position[]>;
			/** The caller's committee grants, memoised the same way. See `capability-grants.ts`. */
			committeeGrants?: Promise<CommitteeGrant[]>;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}

	/** The bindings `env` from `cloudflare:workers` carries (wrangler.toml). */
	namespace Cloudflare {
		interface Env {
			DB: D1Database;
			R2_BUCKET: R2Bucket;
			R2_PRIVATE: R2Bucket;
			KV: KVNamespace;
		}
	}
}

export {};
