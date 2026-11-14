import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { reviewKinds, rowDecisions, type ReviewKind } from '#lib/types/review.js';

// `FormGuard`, which `<Form>` imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

/** The surface `Form` and `Action` touch on a remote form; `.for()` returns the same fake. */
const remoteForm = (name: string) => {
	const fake: Record<string, unknown> = {
		enhance: () => ({ method: 'POST', action: `?/${name}` }),
		fields: new Proxy(
			{},
			{
				get: (_, key) =>
					key === 'allIssues'
						? () => null
						: {
								as: (type: string, value?: unknown) => ({ type, name: String(key), value }),
								issues: () => null,
								value: () => undefined
							}
			}
		),
		result: undefined
	};
	fake.for = () => fake;
	return fake;
};
const forms = (...names: string[]) => Object.fromEntries(names.map((n) => [n, remoteForm(n)]));

vi.mock('#lib/remote/volunteer.remote.js', () =>
	forms(
		'approveVolunteerHours',
		'approveVolunteerSignup',
		'confirmSignup',
		'rejectVolunteerHours',
		'releaseSignup'
	)
);
vi.mock('#lib/remote/community-events.remote.js', () => forms('approveListing', 'rejectListing'));
vi.mock('#lib/remote/classifieds.remote.js', () => forms('moderateClassified'));
vi.mock('#lib/remote/local-resources.remote.js', () =>
	forms('publishLocalResourceForm', 'rejectLocalResourceForm')
);
vi.mock('#lib/remote/suggestions.remote.js', () =>
	forms('reviewSuggestion', 'reviewSuggestionEdit')
);

const ReviewRowDecisions = (await import('./ReviewRowDecisions.svelte')).default;

const item = (kind: ReviewKind) => ({
	id: `${kind}:x1`,
	kind,
	subjectId: 'x1',
	ref: { type: 'event' as const, id: 'r1', title: 'Fixture' }
});

const offered = (container: HTMLElement) =>
	[...container.querySelectorAll('[data-review-decision]')].map((el) =>
		el.getAttribute('data-review-decision')
	);

describe('ReviewRowDecisions', () => {
	it('offers approve and decline on a one-click kind', async () => {
		const { container } = await render(ReviewRowDecisions, {
			item: item('listing'),
			kindLabel: 'Fixture kind',
			ondecided: vi.fn()
		});
		expect(offered(container)).toEqual(['approve', 'decline']);
	});

	it('offers return, not decline, on a kind whose record goes back for edits', async () => {
		for (const kind of ['resource_tip', 'hour_log'] as const) {
			const { container, unmount } = await render(ReviewRowDecisions, {
				item: item(kind),
				kindLabel: 'Fixture kind',
				ondecided: vi.fn()
			});
			expect(offered(container), kind).toEqual(['approve', 'return']);
			await unmount();
		}
	});

	it('offers nothing on a kind decided with a written message', async () => {
		for (const kind of ['flag', 'appeal', 'market_vendor', 'group_application'] as const) {
			const { container, unmount } = await render(ReviewRowDecisions, {
				item: item(kind),
				kindLabel: 'Fixture kind',
				ondecided: vi.fn()
			});
			expect(container.querySelector('[data-testid="review-decisions"]')).toBeNull();
			await unmount();
		}
	});

	it('offers exactly the decisions each kind declares', async () => {
		for (const kind of reviewKinds) {
			const { container, unmount } = await render(ReviewRowDecisions, {
				item: item(kind),
				kindLabel: 'Fixture kind',
				ondecided: vi.fn()
			});
			const declared = (rowDecisions as Partial<Record<ReviewKind, readonly string[]>>)[kind];
			expect(offered(container), kind).toEqual(declared ? [...declared] : []);
			await unmount();
		}
	});
});
