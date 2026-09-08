import { describe, it, expect, vi, beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

/**
 * The one behaviour worth a browser test: a list of tracks shares a single
 * `<audio>` element, so playing a second track replaces the first rather than
 * layering on top of it. Per-element players are the obvious implementation and
 * the failure they produce — two songs at once — is not something a unit test
 * over the component's props would ever see.
 */

// Headless chromium will not decode media, so a real `play()` rejects and every
// assertion below would be about codec support rather than about the component.
//
// The stub has to do more than resolve, though. `paused` is a read-only getter
// fed by the element's own playback, and `bind:paused` tracks it through the
// `play`/`pause` events — so a stub that merely resolves leaves the element
// paused forever and every row keeps saying "Play". Backing `paused` with a
// variable and firing the events is what makes the binding behave the way it
// does in a browser that can actually play something.
let pausedState = true;
Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
	configurable: true,
	get: () => pausedState
});

const play = vi.fn(function (this: HTMLMediaElement) {
	pausedState = false;
	this.dispatchEvent(new Event('play'));
	return Promise.resolve();
});
const pause = vi.fn(function (this: HTMLMediaElement) {
	pausedState = true;
	this.dispatchEvent(new Event('pause'));
});

beforeEach(() => {
	vi.clearAllMocks();
	pausedState = true;
	HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play'];
	HTMLMediaElement.prototype.pause = pause as unknown as HTMLMediaElement['pause'];
	HTMLMediaElement.prototype.load = vi.fn();
});

// Module-scope dynamic import: it resolves after the mocks above, and paying the
// cold Vite transform during file evaluation keeps it out of a 5s test timeout.
const TrackList = (await import('./TrackList.svelte')).default;

const TRACKS = [
	{ id: 'track-a', title: 'Ferris Wheel', trackNumber: 1, durationMs: 222_000 },
	{ id: 'track-b', title: 'Cold Garage', trackNumber: 2, durationMs: 185_000 }
];

describe('TrackList', () => {
	it('renders one row per track with its length', async () => {
		await render(TrackList, { tracks: TRACKS });

		await expect.element(page.getByText('Ferris Wheel')).toBeInTheDocument();
		await expect.element(page.getByText('Cold Garage')).toBeInTheDocument();
		await expect.element(page.getByText('3:42')).toBeInTheDocument();
	});

	it('shows the empty message instead of an empty list', async () => {
		await render(TrackList, { tracks: [], empty: 'Nothing here yet.' });
		await expect.element(page.getByText('Nothing here yet.')).toBeInTheDocument();
	});

	it('keeps exactly one audio element however many tracks there are', async () => {
		// The structural guarantee. Ten tracks holding ten elements means ten
		// buffered ranges the moment anyone scrubs, and pausing one does not stop
		// another.
		const { container } = await render(TrackList, { tracks: TRACKS });
		expect(container.querySelectorAll('audio')).toHaveLength(1);
	});

	it('plays a track from its own row button', async () => {
		await render(TrackList, { tracks: TRACKS });
		await page.getByRole('button', { name: 'Play Ferris Wheel' }).click();
		expect(play).toHaveBeenCalled();
	});

	it('points the shared element at the second track when the second row is played', async () => {
		const { container } = await render(TrackList, { tracks: TRACKS });

		await page.getByRole('button', { name: 'Play Ferris Wheel' }).click();
		await page.getByRole('button', { name: 'Play Cold Garage' }).click();

		const audio = container.querySelector('audio')!;
		// Swapping `src` on one element is what makes "only one thing plays"
		// structural rather than something every handler has to remember.
		expect(audio.getAttribute('src') ?? audio.src).toContain('track-b');
	});

	it('offers pause on the row that is playing, and play on the other', async () => {
		await render(TrackList, { tracks: TRACKS });
		await page.getByRole('button', { name: 'Play Ferris Wheel' }).click();

		await expect
			.element(page.getByRole('button', { name: 'Pause Ferris Wheel' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Play Cold Garage' }))
			.toBeInTheDocument();
	});

	it('falls back to a play button when the browser refuses to start', async () => {
		// Autoplay policy, a 404 on the stream, an unsupported codec — all of them
		// surface as a rejected `play()`, and a row left claiming to play is worse
		// than one that visibly did not.
		// Rejects *without* flipping `paused`, which is what a blocked autoplay or
		// a 404 on the stream actually does.
		play.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
		await render(TrackList, { tracks: TRACKS });

		await page.getByRole('button', { name: 'Play Ferris Wheel' }).click();
		await expect
			.element(page.getByRole('button', { name: 'Play Ferris Wheel' }))
			.toBeInTheDocument();
	});
});
