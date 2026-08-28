<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BadgeList from './BadgeList.svelte';

	const { Story } = defineMeta({
		title: 'Shared/BadgeList',
		component: BadgeList,
		tags: ['autodocs']
	});

	const roles = ['Door', 'Merch', 'Sound', 'Load-in', 'Clean, maintain, and repair'];
</script>

<Story name="Clamped" args={{ items: roles, max: 2 }} />
<Story name="Under the clamp" args={{ items: roles.slice(0, 2), max: 2 }} />
<Story name="Unclamped" args={{ items: roles }} />
<Story name="Wrapping" args={{ items: roles, wrap: true }} />
<Story name="Extra small" args={{ items: roles, max: 3, size: 'xs' }} />
<Story name="Primary" args={{ items: roles, max: 2, variant: 'primary' }} />
<!-- Renders nothing at all, so a caller's `{:else}` owns the empty case. -->
<Story name="Empty" args={{ items: [] }} />
