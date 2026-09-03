/**
 * Screenshots for `docs/handoff/press-kit.md`.
 *
 * `minText` thresholds below are ~65% of measured rendered length, not guesses —
 * the measurements are in the doc's "Regenerating this" section. The sparse end
 * is real: the band dashboard renders ~510 characters and is correct.
 *
 * Run against a dev server that is already up (see the doc's "Regenerating
 * this" section). Two accounts cover the whole area, so each signs in once and
 * shoots its group of screens together.
 *
 * `ONLY=id,id` reshoots a subset. That is what makes iterating on one screen
 * affordable — a full run is ~40 images across two viewports.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:41077';
const OUT = join(process.cwd(), 'docs/handoff/press-kit/images');
const ONLY =
	process.env.ONLY?.split(',')
		.map((s) => s.trim())
		.filter(Boolean) ?? [];

const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'mobile', width: 390, height: 844 }
] as const;

/** An account, and the screens shot while signed in as it. `null` = signed out. */
interface Group {
	account: { email: string; password: string } | null;
	screens: Screen[];
}

interface Screen {
	id: string;
	path: string;
	/**
	 * Text only real data produces. Navigation resolves on the document, not on
	 * the async query underneath, so without this the shot is a header over an
	 * empty container — which reads exactly like a correct empty state.
	 */
	expect: string | RegExp;
	/** Minimum rendered characters. Measured, not guessed — see the doc. */
	minText: number;
	/** Run before shooting: open a panel, dismiss something. */
	prepare?: (page: Page) => Promise<void>;
	/**
	 * Shoot one element rather than the page.
	 *
	 * `scrollIntoViewIfNeeded` before a `fullPage` shot changes nothing — the
	 * capture is the whole document either way — so a "detail" screen written
	 * that way silently produces a byte-identical duplicate of its parent. This
	 * one did, and only an md5 caught it.
	 */
	clip?: string;
}

const FREE = { email: 'soloact@corvallismusic.org', password: 'password' };
const STAFF = { email: 'admin@corvallismusic.org', password: 'password' };

const GROUPS: Group[] = [
	{
		account: null,
		screens: [
			{
				id: 'public-profile-free',
				path: '/directory/bands/wren-halloway',
				expect: /Press|Booking/,
				minText: 700
			},
			{
				id: 'public-profile-premium',
				path: '/directory/bands/thevoltagethieves',
				expect: /Press|Watch/,
				minText: 800
			},
			{ id: 'directory-index', path: '/directory', expect: /Bands|Acts/i, minText: 900 }
		]
	},
	{
		account: FREE,
		screens: [
			{
				id: 'band-dashboard-ladder',
				path: '/band/wren-halloway',
				expect: /Press kit/,
				minText: 350
			},
			{
				id: 'press-kit-editor',
				path: '/band/wren-halloway/press-kit',
				expect: /of 12 pieces/,
				minText: 1800
			},
			{
				id: 'press-kit-photos',
				path: '/band/wren-halloway/press-kit',
				expect: /1 of 1/,
				minText: 1800,
				// The photo cap at its limit — the one state proving
				// `FREE_PRESS_PHOTOS` is enforced rather than merely declared, with
				// the add button disabled and the upsell named.
				// `.card` + the title text. Not a heading-tag selector: `CardTitle`
				// defaults to `<h3>` and changes level by depth, so `h2` matched
				// nothing here.
				clip: '.card:has-text("Press photos")'
			},
			{
				id: 'profile-editor',
				path: '/band/wren-halloway/edit',
				expect: /Where enquiries go/,
				minText: 600
			},
			{
				id: 'subscription-upsell',
				path: '/band/wren-halloway/subscription',
				expect: /video section|Unlimited press photos/,
				minText: 450
			}
		]
	},
	{
		account: STAFF,
		screens: [
			{
				id: 'press-kit-editor-premium',
				path: '/band/thevoltagethieves/press-kit',
				expect: /Video/,
				minText: 1900
			},
			{
				id: 'page-editor-preview',
				path: '/band/thevoltagethieves/page-editor',
				expect: /Preview/,
				minText: 1200,
				prepare: async (page) => {
					await page.getByText('Preview', { exact: true }).scrollIntoViewIfNeeded();
				}
			},
			{
				id: 'band-site',
				path: '/band-site/thevoltagethieves',
				expect: /./,
				minText: 800
			},
			{
				id: 'band-site-epk',
				path: '/band-site/thevoltagethieves/epk',
				expect: /Electronic Press Kit|Press/,
				minText: 800
			}
		]
	}
];

async function signIn(page: Page, account: { email: string; password: string }) {
	// Through the API, not the form. The login form is client-rendered, and a
	// submit that lands pre-hydration GETs its fields into the URL instead.
	// `origin` is not optional: SvelteKit's CSRF check rejects a POST without one
	// as a 403, and better-auth's own 404 for the same request is even more
	// confusing to debug.
	const res = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
		headers: { origin: BASE },
		data: { email: account.email, password: account.password }
	});
	if (!res.ok()) throw new Error(`sign-in failed for ${account.email}: ${res.status()}`);
	// `/sign-in` is rate limited at a few attempts per few seconds, and where the
	// client IP cannot be resolved every caller shares one bucket.
	await page.waitForTimeout(4000);
}

async function shoot(page: Page, screen: Screen, viewport: string) {
	await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });

	// Data-bearing, never `networkidle`.
	await page.getByText(screen.expect).first().waitFor({ state: 'visible', timeout: 20000 });
	await page.evaluate(() => document.fonts.ready);
	if (screen.prepare) await screen.prepare(page);
	await page.waitForTimeout(400);

	const text = (await page.locator('body').innerText()).trim();
	if (text.length < screen.minText) {
		throw new Error(
			`${screen.id} @${viewport}: ${text.length} chars < ${screen.minText} — page rendered thin, refusing to save a misleading shot`
		);
	}

	// `fullPage` captures the *document* scroll. This shell pins the frame to the
	// viewport and scrolls an inner element, so `fullPage` would silently return
	// exactly one screen. Grow the window to the content height instead.
	const contentHeight = await page.evaluate(() => {
		const doc = document.documentElement.scrollHeight;
		const inner = Math.max(
			...[...document.querySelectorAll('main, [class*=overflow]')].map((e) => e.scrollHeight),
			0
		);
		return Math.max(doc, inner);
	});
	const vp = page.viewportSize()!;
	if (contentHeight > vp.height) {
		await page.setViewportSize({ width: vp.width, height: Math.min(contentHeight + 80, 6000) });
		await page.waitForTimeout(250);
	}

	const file = join(OUT, `${screen.id}-${viewport}.png`);
	if (screen.clip) {
		const el = page.locator(screen.clip).first();
		await el.scrollIntoViewIfNeeded();
		await page.waitForTimeout(200);
		await el.screenshot({ path: file });
	} else {
		await page.screenshot({ path: file, fullPage: true });
	}
	await page.setViewportSize(vp);

	const bytes = statSync(file).size;
	// A blank page still writes a valid PNG. File size is the backstop the
	// selectors above cannot be.
	const floor = screen.clip ? 4000 : 15000;
	if (bytes < floor)
		throw new Error(`${screen.id} @${viewport}: ${bytes} bytes — implausibly small`);
	return { file, bytes, chars: text.length };
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const browser: Browser = await chromium.launch();
	const report: Record<string, unknown>[] = [];
	let failures = 0;

	for (const viewport of VIEWPORTS) {
		for (const group of GROUPS) {
			const screens = group.screens.filter((s) => ONLY.length === 0 || ONLY.includes(s.id));
			if (screens.length === 0) continue;

			const context = await browser.newContext({
				viewport: { width: viewport.width, height: viewport.height },
				// 1, not 2. Retina shots of these pages run ~1MB each and this doc is
				// meant to be *regenerated* — at 2x, every regeneration adds ~10MB to
				// git history permanently. Text at 1440 CSS px maps 1:1 and stays
				// legible; the tradeoff is deliberate, not an oversight.
				deviceScaleFactor: 1,
				reducedMotion: 'reduce'
			});
			const page = await context.newPage();
			if (group.account) await signIn(page, group.account);

			for (const screen of screens) {
				try {
					const out = await shoot(page, screen, viewport.name);
					report.push({ id: screen.id, viewport: viewport.name, ...out, ok: true });
					console.log(
						`  ✓ ${screen.id} @${viewport.name}  ${out.chars} chars, ${Math.round(out.bytes / 1024)}KB`
					);
				} catch (e) {
					failures++;
					report.push({ id: screen.id, viewport: viewport.name, ok: false, error: String(e) });
					console.error(
						`  ✗ ${screen.id} @${viewport.name}: ${e instanceof Error ? e.message : e}`
					);
				}
			}
			await context.close();
		}
	}

	await browser.close();
	writeFileSync(join(OUT, '../capture-report.json'), JSON.stringify(report, null, 2));
	console.log(`\n${report.filter((r) => r.ok).length} captured, ${failures} failed`);
	if (failures > 0) process.exitCode = 1;
}

void main();
