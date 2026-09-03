import { describe, it, expect, vi, beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

/**
 * The station bar. Two things here are worth a browser test and could not be
 * asserted anywhere else.
 *
 * **Clock-skew correction.** The widget seeks to `serverNow - startsAt`, not to
 * `Date.now() - startsAt`. A listener whose machine is a minute fast would
 * otherwise start every track a minute in — or past its end, which reads as the
 * station being broken — and "everybody hears the same thing" would be true only
 * for people with an accurate clock. The test drives it with a local clock years
 * out and expects the same offset.
 *
 * **The three dismissal states.** A control that vanishes with no way back is
 * worse than one never offered, so `hidden` has to be reachable and distinct
 * from `collapsed`.
 */

// A fixed point far enough from the real clock that any use of local time
// instead of server time produces an absurd number rather than a near-miss.
const SERVER_NOW = new Date('2020-01-01T12:00:30Z');
const STARTS_AT = new Date('2020-01-01T12:00:00Z'); // 30s before "now"
const ENDS_AT = new Date('2020-01-01T12:03:00Z');

const ENTRY = {
	playId: 'play-1',
	trackId: 'track-1',
	trackTitle: 'Ferris Wheel',
	releaseId: 'rel-1',
	releaseTitle: 'Marys Peak',
	bandName: 'Sour Cherry',
	bandSlug: 'sour-cherry',
	coverUrl: null,
	startsAt: STARTS_AT,
	endsAt: ENDS_AT,
	durationMs: 180_000
};

let radioState: Record<string, unknown> = {};
vi.mock('$lib/remote/radio.remote', () => ({
	getRadioState: () => Promise.resolve(radioState)
}));

/** Captured assignments to `currentTime` — the seek the component asked for. */
let seeks: number[] = [];
let pausedState = true;
const play = vi.fn(function (this: HTMLMediaElement) {
	pausedState = false;
	this.dispatchEvent(new Event('play'));
	return Promise.resolve();
});

beforeEach(() => {
	vi.clearAllMocks();
	seeks = [];
	pausedState = true;
	localStorage.clear();

	radioState = { enabled: true, serverNow: SERVER_NOW, current: ENTRY, upNext: [] };

	// Headless chromium will not decode media, so `play()` is stubbed. `paused`
	// is a read-only getter driven by real playback, and `bind:paused` tracks it
	// through the play/pause events — a stub that only resolves leaves the bar
	// saying "Play" forever.
	Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
		configurable: true,
		get: () => pausedState
	});
	// `currentTime` is likewise inert without loaded media: assigning to it on a
	// real element with no source is silently dropped, so the arithmetic under
	// test would be unobservable. Capturing the assignment tests what the
	// component computed rather than what the media pipeline did with it.
	Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
		configurable: true,
		get: () => seeks.at(-1) ?? 0,
		set: (v: number) => void seeks.push(v)
	});
	HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play'];
	HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
		pausedState = true;
		this.dispatchEvent(new Event('pause'));
	}) as unknown as HTMLMediaElement['pause'];
});

// Module scope, after the mocks, so the cold Vite transform is paid during file
// evaluation rather than inside a 5s test timeout.
const RadioPlayer = (await import('./RadioPlayer.svelte')).default;

describe('RadioPlayer', () => {
	it('renders the current track and links the band', async () => {
		await render(RadioPlayer);

		await expect.element(page.getByText('Ferris Wheel')).toBeInTheDocument();
		const link = page.getByRole('link', { name: 'Sour Cherry' });
		await expect.element(link).toBeInTheDocument();
		// The whole reason the widget exists: whoever is playing is one click from
		// their profile.
		await expect.element(link).toHaveAttribute('href', '/directory/bands/sour-cherry');
	});

	it('renders nothing while the flag is off', async () => {
		radioState = { enabled: false, serverNow: SERVER_NOW, current: null, upNext: [] };
		const { container } = await render(RadioPlayer);

		// A switched-off station must not leave a bar, an empty strip, or an audio
		// element on every page in the app.
		await expect.element(page.getByLabelText('CMC Radio')).not.toBeInTheDocument();
		expect(container.querySelectorAll('audio')).toHaveLength(0);
	});

	it('renders nothing when the rotation is empty', async () => {
		// Enabled but nothing scheduled — the state before enough bands opt in.
		radioState = { enabled: true, serverNow: SERVER_NOW, current: null, upNext: [] };
		const { container } = await render(RadioPlayer);
		expect(container.querySelectorAll('audio')).toHaveLength(0);
	});

	it('does not autoplay', async () => {
		// Browsers block it, and a bar that claims to be playing when it is not is
		// worse than one that visibly is not.
		await render(RadioPlayer);
		await expect.element(page.getByRole('button', { name: 'Play CMC Radio' })).toBeInTheDocument();
		expect(play).not.toHaveBeenCalled();
	});

	it('seeks to the live position using the server clock, not the local one', async () => {
		await render(RadioPlayer);
		await page.getByRole('button', { name: 'Play CMC Radio' }).click();

		expect(play).toHaveBeenCalled();
		// The local clock is years off from SERVER_NOW. Anything that reached for
		// `Date.now()` would land in the millions here; the answer is 30.
		expect(seeks.at(-1)).toBeCloseTo(30, 0);
	});

	it('points the element at the stream for the track that is on', async () => {
		const { container } = await render(RadioPlayer);
		await page.getByRole('button', { name: 'Play CMC Radio' }).click();

		const audio = container.querySelector('audio')!;
		expect(audio.getAttribute('src') ?? audio.src).toContain('/api/audio/track/track-1/stream');
	});

	it('collapses to a pill, and the pill reopens the bar', async () => {
		await render(RadioPlayer);

		await page.getByRole('button', { name: 'Minimize CMC Radio' }).click();
		const pill = page.getByRole('button', { name: 'CMC Radio' });
		await expect.element(pill).toBeInTheDocument();

		await pill.click();
		await expect.element(page.getByRole('button', { name: 'Play CMC Radio' })).toBeInTheDocument();
	});

	it('closes completely, and remembers it', async () => {
		await render(RadioPlayer);
		await page.getByRole('button', { name: 'Close CMC Radio' }).click();

		await expect.element(page.getByLabelText('CMC Radio')).not.toBeInTheDocument();
		// Remembered, or the bar returns on the next page load and "dismiss" means
		// nothing. /radio clears this — that is the way back.
		expect(localStorage.getItem('cmc:radio-widget')).toBe('hidden');
	});

	it('stays closed on a later visit', async () => {
		localStorage.setItem('cmc:radio-widget', 'hidden');
		const { container } = await render(RadioPlayer);
		expect(container.querySelectorAll('audio')).toHaveLength(0);
	});

	it('opens as the bar when nothing has been stored', async () => {
		// An absent entry means open: a visitor who has never expressed a
		// preference should meet the station.
		await render(RadioPlayer);
		await expect.element(page.getByRole('button', { name: 'Play CMC Radio' })).toBeInTheDocument();
	});
});
