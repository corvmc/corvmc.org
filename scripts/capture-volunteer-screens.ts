/**
 * Screenshot every volunteer screen, signed in, populated, at two viewports.
 *
 * Usage:
 *   pnpm dev            # in this checkout, on the port it owns
 *   pnpm screens:volunteer
 *
 * The output is the illustration half of `docs/reports/volunteer-view-handoff.md`.
 * It is a script rather than a one-off because the handoff is only worth as much
 * as its screenshots are current, and re-running this is the cheapest way to make
 * them so.
 *
 * Two things it is careful about:
 *
 * - **The render gate.** `page.goto` resolves as soon as the document does, which
 *   is before an awaited remote query has committed — screenshot there and you
 *   get a header over an empty `<main>` that looks exactly like a correct
 *   empty state. Every screen therefore names a `ready` selector, and every
 *   screen additionally waits for `<main>` to carry real text. A screen that
 *   never satisfies both fails the run instead of saving a blank.
 * - **The logins.** It drives the four demo personas seeded by
 *   `seedVolunteerPersonas` in `scripts/seed-dev.ts`. Three of the five
 *   member-facing pages are gated on onboarding stage, so no single account can
 *   reach them all.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devPort } from './lib/checkout-ports';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? `http://localhost:${devPort(root)}`;
const OUT = join(root, 'docs/reports/screenshots/volunteer');

const PERSONAS = {
	coordinator: 'coordinator@corvallismusic.org',
	volunteer: 'volunteer@corvallismusic.org',
	newcomer: 'newcomer@corvallismusic.org',
	minor: 'minor@corvallismusic.org'
} as const;
type PersonaKey = keyof typeof PERSONAS;

type Screen = {
	id: string;
	persona: PersonaKey;
	path: string;
	/** Waited for after navigation. Prefer something only data can produce. */
	ready: string;
	/** Click-through: open a modal, or follow a link to a detail page. */
	act?: (page: Page) => Promise<void>;
	/** Waited for after `act`. */
	then?: string;
	/** Minimum characters of `<main>` text. Lower it for genuinely sparse pages. */
	minText?: number;
};

const DIALOG = '[role="dialog"]';

const failures: string[] = [];

const SCREENS: Screen[] = [
	// --- Member -------------------------------------------------------------
	{
		id: 'member-dashboard',
		persona: 'volunteer',
		path: '/member/volunteer',
		ready: 'text=Your shifts'
	},
	{
		id: 'member-hours',
		persona: 'volunteer',
		path: '/member/volunteer/hours',
		ready: "h1:has-text('Your hours')"
	},
	{
		id: 'member-interests',
		persona: 'volunteer',
		path: '/member/volunteer/interests',
		ready: 'text=Not a commitment'
	},
	{
		id: 'member-feedback',
		persona: 'volunteer',
		path: '/member/volunteer/feedback/seed-vol-signup-feedback',
		ready: 'h1:has-text("How did it go?")',
		minText: 120
	},
	{
		id: 'member-start',
		persona: 'newcomer',
		path: '/member/volunteer/start',
		ready: 'text=Asked once',
		minText: 150
	},
	{
		id: 'member-blocked',
		persona: 'minor',
		path: '/member/volunteer/blocked',
		ready: 'h1:has-text("Almost there")',
		minText: 100
	},

	// --- Member modals ------------------------------------------------------
	{
		id: 'modal-member-log-hours',
		persona: 'volunteer',
		path: '/member/volunteer/hours',
		ready: "h1:has-text('Your hours')",
		act: (p) => p.getByRole('button', { name: 'Log Hours', exact: true }).first().click(),
		then: `${DIALOG} >> text=Log hours`
	},
	{
		id: 'modal-member-log-shift-hours',
		persona: 'volunteer',
		path: '/member/volunteer',
		ready: 'text=Hours to log',
		act: (p) => p.getByRole('button', { name: 'Log these hours' }).first().click(),
		then: `${DIALOG} >> text=Pre-filled from the shift`
	},
	{
		id: 'modal-member-claim-shift',
		persona: 'volunteer',
		path: '/member/volunteer',
		ready: 'text=Open shifts',
		act: (p) => p.getByRole('button', { name: "I'll do it" }).first().click(),
		then: `${DIALOG} >> text=Claim this shift?`
	},
	{
		id: 'modal-member-drop-out',
		persona: 'volunteer',
		path: '/member/volunteer',
		ready: 'text=Your shifts',
		act: (p) => p.getByRole('button', { name: 'Drop out' }).first().click(),
		then: `${DIALOG} >> text=Drop out of this shift?`
	},
	{
		id: 'modal-member-profile',
		persona: 'volunteer',
		path: '/member/volunteer',
		ready: 'text=Your shifts',
		act: (p) => p.getByRole('button', { name: 'Profile', exact: true }).first().click(),
		then: `${DIALOG} >> text=Your volunteer profile`
	},

	// --- Staff --------------------------------------------------------------
	{
		id: 'staff-today',
		persona: 'coordinator',
		path: '/staff/volunteer',
		ready: 'text=Needs confirming'
	},
	{
		id: 'staff-schedule',
		persona: 'coordinator',
		path: '/staff/volunteer/schedule',
		ready: 'h1:has-text("Schedule")'
	},
	{
		id: 'staff-schedule-everything',
		persona: 'coordinator',
		path: '/staff/volunteer/schedule?days=all',
		ready: 'h1:has-text("Schedule")'
	},
	{
		id: 'staff-people',
		persona: 'coordinator',
		path: '/staff/volunteer/people',
		ready: 'h1:has-text("People")'
	},
	{
		id: 'staff-people-signoff',
		persona: 'coordinator',
		path: '/staff/volunteer/people?tab=signoff',
		ready: "text=Can't claim shifts",
		// Three rows of name and email, and at mobile the table drops its
		// supporting columns: 337 characters all in.
		minText: 250
	},
	{
		id: 'staff-people-cleared',
		persona: 'coordinator',
		path: '/staff/volunteer/people?tab=cleared',
		// The footnote, not the filter's placeholder option: FilterBar collapses
		// behind a button at mobile widths, so anything inside it is absent from
		// the DOM until somebody presses that.
		ready: "text=Grants are made on a person's record"
	},
	{
		id: 'staff-setup',
		persona: 'coordinator',
		path: '/staff/volunteer/setup',
		ready: 'text=Sound Engineering'
	},
	{
		id: 'staff-report',
		persona: 'coordinator',
		path: '/staff/volunteer/report',
		ready: 'text=Approved hours'
	},
	{
		id: 'staff-hours',
		persona: 'coordinator',
		path: '/staff/volunteer/hours',
		ready: 'h1:has-text("Hours to review")'
	},
	{
		id: 'staff-shift-detail',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-claimed',
		ready: 'text=Who to ask',
		minText: 180
	},
	{
		id: 'staff-shift-cancelled',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-cancelled',
		ready: 'text=Who to tell',
		minText: 180
	},
	{
		id: 'staff-role-detail',
		persona: 'coordinator',
		path: '/staff/volunteer/setup',
		ready: 'text=Front Desk',
		act: (p) => p.getByRole('link', { name: 'Front Desk', exact: false }).first().click(),
		then: 'text=Role Info'
	},
	{
		id: 'staff-user-volunteer-tab',
		persona: 'coordinator',
		path: '/staff/users/seed-vol-active?tab=volunteer',
		ready: 'text=Certifications'
	},

	// --- Staff modals -------------------------------------------------------
	{
		id: 'modal-staff-new-shift',
		persona: 'coordinator',
		path: '/staff/volunteer/schedule',
		ready: 'h1:has-text("Schedule")',
		act: (p) => p.getByRole('button', { name: 'New Shift' }).first().click(),
		then: `${DIALOG} >> text=Schedule a shift`
	},
	{
		id: 'modal-staff-confirm-signup',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-claimed',
		ready: 'text=Who to ask',
		minText: 180,
		act: (p) => p.locator('button[data-button-root][aria-label="Confirm"]').first().click(),
		then: `${DIALOG}`
	},
	{
		id: 'modal-staff-edit-shift',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-claimed',
		ready: 'text=Who to ask',
		minText: 180,
		act: (p) => p.getByRole('button', { name: 'Edit', exact: true }).first().click(),
		then: `${DIALOG} >> text=Edit this shift`
	},
	{
		id: 'modal-staff-cancel-shift',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-claimed',
		ready: 'text=Who to ask',
		minText: 180,
		act: (p) => p.getByRole('button', { name: 'Cancel shift' }).first().click(),
		then: `${DIALOG} >> text=Cancel this shift?`
	},
	{
		id: 'modal-staff-notify-cancelled',
		persona: 'coordinator',
		path: '/staff/volunteer/shifts/seed-vol-shift-cancelled',
		ready: 'text=Who to tell',
		minText: 180,
		act: (p) => p.getByRole('button', { name: 'Notify all' }).first().click(),
		then: `${DIALOG} >> text=Tell everybody this is off?`
	},
	{
		id: 'modal-staff-approve-hours',
		persona: 'coordinator',
		path: '/staff/volunteer/hours',
		ready: 'h1:has-text("Hours to review")',
		act: (p) => p.getByRole('button', { name: 'Approve', exact: true }).first().click(),
		then: `${DIALOG} >> text=Approve these hours?`
	},
	{
		id: 'modal-staff-return-hours',
		persona: 'coordinator',
		path: '/staff/volunteer/hours',
		ready: 'h1:has-text("Hours to review")',
		act: (p) => p.getByRole('button', { name: 'Return', exact: true }).first().click(),
		then: `${DIALOG} >> text=Return these hours?`
	},
	{
		id: 'modal-staff-log-hours-for-member',
		persona: 'coordinator',
		path: '/staff/volunteer/people',
		ready: 'h1:has-text("People")',
		act: (p) => p.getByRole('button', { name: 'Log hours for someone' }).first().click(),
		then: `${DIALOG} >> text=Log hours for a member`
	},
	{
		id: 'modal-staff-new-role',
		persona: 'coordinator',
		path: '/staff/volunteer/setup',
		ready: 'text=Sound Engineering',
		act: (p) => p.getByRole('button', { name: 'New Role' }).first().click(),
		then: `${DIALOG} >> text=New volunteer role`
	},
	{
		id: 'modal-staff-new-clearance',
		persona: 'coordinator',
		path: '/staff/volunteer/setup',
		ready: 'text=Sound Engineering',
		act: (p) => p.getByRole('button', { name: 'New Clearance' }).first().click(),
		then: `${DIALOG} >> text=New clearance`
	},
	{
		id: 'modal-staff-grant-certification',
		persona: 'coordinator',
		path: '/staff/users/seed-vol-active?tab=volunteer',
		ready: 'text=Certifications',
		act: (p) => p.getByRole('button', { name: 'Grant', exact: true }).first().click(),
		then: `${DIALOG} >> text=Grant a certification`
	}
];

/**
 * `ONLY=staff-hours,member-start` re-shoots just those, which is how you iterate
 * on one screen without paying for the other sixty.
 */
const ONLY = process.env.ONLY?.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const WANTED = ONLY ? SCREENS.filter((s) => ONLY.includes(s.id)) : SCREENS;

const VIEWPORTS = [
	{ key: 'desktop', width: 1440, height: 900 },
	{ key: 'mobile', width: 390, height: 844 }
] as const;

async function signIn(page: Page, email: string) {
	await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
	// The sign-in form is deliberately client-mounted, and a submit landed before
	// hydration GETs the fields into the URL instead of authenticating. Waiting
	// for the button to be enabled is the cheapest proof the island is live.
	const submit = page.getByRole('button', { name: 'Sign in', exact: true });
	await submit.waitFor({ state: 'visible', timeout: 30_000 });
	await page.locator('input[type="email"]').first().fill(email);
	await page.locator('input[name="password"]').first().fill('password');
	await submit.click();
	await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function settle(page: Page, selector: string, minText: number) {
	await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 });
	// The selector proves the shell rendered; this proves the data did. A page
	// whose awaited query has not committed yet has a header and nothing else.
	await page.waitForFunction(
		(min) => (document.querySelector('main')?.innerText.length ?? 0) >= min,
		minText,
		{ timeout: 30_000 }
	);
	await page.evaluate(() => document.fonts.ready);
}

/** Tallest a screenshot is allowed to get, in CSS pixels. */
const MAX_HEIGHT = 10_000;

/**
 * Grow the viewport to the height of the content, then shoot.
 *
 * Playwright's `fullPage` extends the *document's* scroll, and in this app the
 * document does not scroll — the frame is `h-dvh` and `<main>` is the scroll
 * container (`overflow-y-auto`). So `fullPage` silently returns exactly one
 * viewport and everything below the fold is missing, which on a dashboard of
 * stacked cards means most of the page. Resizing the window is what actually
 * lengthens `<main>`.
 *
 * A modal is measured instead of the page behind it: it is portaled and fixed,
 * so it centres itself in whatever height the window has, and growing the window
 * to the page's height would frame it in a screen of empty overlay.
 */
async function shootFullHeight(page: Page, width: number, height: number, path: string) {
	const needed = await page.evaluate(() => {
		const box = document.querySelector('[role="dialog"] .modal-box');
		if (box) return Math.ceil(box.getBoundingClientRect().height) + 80;
		const main = document.querySelector('main');
		if (!main) return document.documentElement.scrollHeight;
		return main.scrollHeight + (window.innerHeight - main.clientHeight);
	});
	const tall = Math.min(Math.max(needed, height), MAX_HEIGHT);
	if (tall !== height) {
		await page.setViewportSize({ width, height: tall });
		// Re-layout, and let anything sticky settle where it lands.
		await page.waitForTimeout(400);
	}
	await page.screenshot({ path, fullPage: true, animations: 'disabled' });
	if (tall !== height) await page.setViewportSize({ width, height });
}

async function capture(browser: Browser, viewport: (typeof VIEWPORTS)[number]) {
	const byPersona = new Map<PersonaKey, Screen[]>();
	for (const s of WANTED) {
		if (!byPersona.has(s.persona)) byPersona.set(s.persona, []);
		byPersona.get(s.persona)!.push(s);
	}

	for (const [persona, screens] of byPersona) {
		const context = await browser.newContext({
			viewport: { width: viewport.width, height: viewport.height },
			deviceScaleFactor: 1,
			reducedMotion: 'reduce'
		});
		const page = await context.newPage();
		await signIn(page, PERSONAS[persona]);

		for (const screen of screens) {
			const label = `${screen.id} @ ${viewport.key}`;
			try {
				await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });
				await settle(page, screen.ready, screen.minText ?? 400);
				if (screen.act) {
					await screen.act(page);
					await page
						.locator(screen.then ?? DIALOG)
						.first()
						.waitFor({ state: 'visible', timeout: 30_000 });
					// bits-ui portals the dialog and fades it in; without this the shot
					// catches it mid-transition.
					await page.waitForTimeout(400);
				}
				await shootFullHeight(
					page,
					viewport.width,
					viewport.height,
					join(OUT, `${screen.id}-${viewport.key}.png`)
				);
				console.log(`  ✓ ${label}`);
			} catch (err) {
				console.error(`  ✗ ${label} — ${(err as Error).message.split('\n')[0]}`);
				failures.push(label);
			}
		}
		await context.close();
	}
}

await mkdir(OUT, { recursive: true });
console.log(`Capturing ${WANTED.length} screens × ${VIEWPORTS.length} viewports from ${BASE}\n`);

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
	console.log(`${viewport.key} (${viewport.width}×${viewport.height}):`);
	await capture(browser, viewport);
}
await browser.close();

// A blank page still writes a valid PNG, so size is the backstop the selectors
// cannot be: nothing this app renders is under 10 KB with a nav bar on it.
const thin: string[] = [];
for (const f of await readdir(OUT)) {
	if (!f.endsWith('.png')) continue;
	if (ONLY && !WANTED.some((s) => f.startsWith(`${s.id}-`))) continue;
	const { size } = await stat(join(OUT, f));
	if (size < 10_000) thin.push(`${f} (${size} bytes)`);
}

console.log(`\n${WANTED.length * VIEWPORTS.length} expected, ${failures.length} failed`);
if (thin.length > 0) console.error(`Suspiciously small:\n  ${thin.join('\n  ')}`);
if (failures.length > 0 || thin.length > 0) process.exit(1);
