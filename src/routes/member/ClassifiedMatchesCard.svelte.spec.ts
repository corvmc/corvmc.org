import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ClassifiedMatchesCard from './ClassifiedMatchesCard.svelte';

// The dashboard's matched classifieds (#2549): absent with nothing to show,
// otherwise one link per post with the tags that matched it.

const match = (id: string, sharedTags: string[]) => ({
	id,
	kind: 'wanted' as const,
	category: 'musician' as const,
	ref: { type: 'classified' as const, id, title: `Post ${id}` },
	sharedTags
});

describe('ClassifiedMatchesCard', () => {
	it('renders nothing when no post matches', async () => {
		const { container } = await render(ClassifiedMatchesCard, { posts: [] });

		expect(container.querySelector('a')).toBeNull();
	});

	it('links each matched post and shows the tags it shares', async () => {
		const { container } = await render(ClassifiedMatchesCard, {
			posts: [match('p1', ['drums']), match('p2', ['surf', 'mixing'])]
		});

		const hrefs = [...container.querySelectorAll('li a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(['/member/classifieds/p1', '/member/classifieds/p2']);
		expect(container.querySelectorAll('li')[1].textContent).toContain('mixing');
	});
});
