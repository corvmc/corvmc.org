<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import IdCardCta from './IdCardCta.svelte';

	// Decorative "join the collective" placeholder ID card — brand art.
	const { Story } = defineMeta({
		title: 'Shared/Directory/IdCardCta',
		component: IdCardCta,
		tags: ['autodocs'],
		parameters: { layout: 'padded' },
		args: { href: '#' }
	});
</script>

<Story name="Default" />
