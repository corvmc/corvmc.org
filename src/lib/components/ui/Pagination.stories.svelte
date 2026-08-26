<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Pagination from './Pagination.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Pagination',
		component: Pagination,
		tags: ['autodocs'],
		args: { onpage: () => {} },
		parameters: {
			docs: {
				description: {
					component:
						'Page buttons are windowed, so a 40-page list renders a handful rather ' +
						'than 40. Pass `pageSize` and `total` — spreading the `pagination` object ' +
						'a paginated `query()` returns does this — to get the "Showing X–Y of Z" ' +
						'line, which renders even for a single page.'
				}
			}
		}
	});
</script>

<!-- One page: no buttons, but the count still tells you how big the list is. -->
<Story name="Single page" args={{ page: 1, totalPages: 1, pageSize: 20, total: 7 }} />

<!-- Few enough pages to list them all — no ellipsis. -->
<Story name="Few pages" args={{ page: 2, totalPages: 5, pageSize: 20, total: 93 }} />

<!-- Ellipsis on the trailing side only. -->
<Story
	name="Many pages, at the start"
	args={{ page: 1, totalPages: 40, pageSize: 20, total: 793 }}
/>

<!-- Ellipsis on both sides. -->
<Story
	name="Many pages, in the middle"
	args={{ page: 20, totalPages: 40, pageSize: 20, total: 793 }}
/>

<!-- Ellipsis on the leading side only. -->
<Story
	name="Many pages, at the end"
	args={{ page: 40, totalPages: 40, pageSize: 20, total: 793 }}
/>

<!-- Without pageSize/total there is no count line. -->
<Story name="Without a count" args={{ page: 3, totalPages: 9 }} />
