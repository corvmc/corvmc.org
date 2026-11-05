import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ErrorEvent, initCloudflareSentryHandle as InitHandle } from '@sentry/sveltekit';
import type { RequestEvent } from '@sveltejs/kit';

// The real SDK, unmocked: the client `initCloudflareSentryHandle` registers must
// be the one `#lib/server/sentry.js` reads, or server captures fall to console.
// Node resolves `@sentry/sveltekit` to a stub handle, so the worker build the
// adapter bundles is loaded by path ('workerd' also needs `cloudflare:workers`).
const pkg = createRequire(import.meta.url).resolve('@sentry/sveltekit/package.json');
const workerEntry = pathToFileURL(join(dirname(pkg), 'build/esm/index.worker.js')).href;

describe('server Sentry against the real SDK', () => {
	it('inits per request and delivers a wrapper capture', async () => {
		const sdk = (await import(/* @vite-ignore */ workerEntry)) as {
			initCloudflareSentryHandle: typeof InitHandle;
		};
		const { captureException } = await import('./sentry');
		const sent: ErrorEvent[] = [];
		const pending: Promise<unknown>[] = [];
		const handle = sdk.initCloudflareSentryHandle({
			dsn: 'https://public@sentry.invalid/1',
			beforeSend(event) {
				sent.push(event);
				return null;
			}
		});
		const event = {
			request: new Request('https://corvmc.org/boom'),
			platform: { context: { waitUntil: (p: Promise<unknown>) => pending.push(p) } },
			locals: {}
		} as unknown as RequestEvent;
		const err = new Error('server capture reaches the client');

		await handle({
			event,
			resolve: async () => {
				captureException(err, { stage: 'spec' });
				return new Response('ok');
			}
		});
		await Promise.all(pending);

		expect(sent).toHaveLength(1);
		expect(sent[0].exception?.values?.[0]?.value).toBe(err.message);
		expect(sent[0].extra).toMatchObject({ stage: 'spec' });
	});
});
