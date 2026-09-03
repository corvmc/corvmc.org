import type { User, Session } from 'better-auth/minimal';
import type { Position } from '$lib/config';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
			/**
			 * The caller's authorization positions, memoised for this request.
			 *
			 * Written and read only by `$lib/server/authorization`; hooks.server.ts
			 * deliberately leaves it undefined so requests that never check a
			 * capability never pay for the read. A promise rather than an array so
			 * that concurrent guards inside one `Promise.all` share a single read
			 * instead of each starting their own.
			 */
			positions?: Promise<Position[]>;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}

		interface Platform {
			env?: {
				DB: D1Database;
				R2_BUCKET: R2Bucket;
				R2_PRIVATE: R2Bucket;
				KV: KVNamespace;
			};
		}
	}
}

export {};
