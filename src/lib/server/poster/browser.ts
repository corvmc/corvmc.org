import puppeteer, { type Browser } from '@cloudflare/puppeteer';
import { env } from 'cloudflare:workers';
import type { PosterPage } from './calendar';

// Long enough for staff flicking between months to land on a warm browser.
const KEEP_ALIVE_MS = 60_000;

/** A Browser Rendering session no one is connected to, or a new one. */
async function acquire(): Promise<Browser> {
	try {
		const idle = (await puppeteer.sessions(env.BROWSER)).find((s) => !s.connectionId);
		if (idle) return await puppeteer.connect(env.BROWSER, idle.sessionId);
	} catch {
		// The idle session closed between listing and connecting; launch instead.
	}
	return puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
}

/**
 * Run `fn` on a fresh page of a Browser Rendering session. The page always
 * closes; the session is left idle for the next render and ends itself after
 * `KEEP_ALIVE_MS`.
 */
export async function withPosterPage<T>(fn: (page: PosterPage) => Promise<T>): Promise<T> {
	const browser = await acquire();
	try {
		const page = await browser.newPage();
		try {
			return await fn({
				setViewport: (v) => page.setViewport(v),
				setContent: (html) => page.setContent(html, { waitUntil: 'load' }),
				evaluate: (script) => page.evaluate(script),
				screenshot: async () => new Uint8Array(await page.screenshot({ type: 'png' })),
				pdf: async (opts) => new Uint8Array(await page.pdf(opts))
			});
		} finally {
			await page.close().catch(() => {});
		}
	} finally {
		await browser.disconnect();
	}
}
