<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import VinylCardCta from './VinylCardCta.svelte';

	// Decorative "add your band" placeholder card — gradients are intentional art.
	const { Story } = defineMeta({
		title: 'Shared/Directory/VinylCardCta',
		component: VinylCardCta,
		tags: ['autodocs'],
		parameters: { layout: 'padded' },
		args: { href: '#' }
	});
</script>

<Story name="Default" />
