<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import VinylCard from './VinylCard.svelte';

	// Decorative brand art — gradients here are intentional (vinyl-record texture).
	const { Story } = defineMeta({
		title: 'Shared/Directory/VinylCard',
		component: VinylCard,
		tags: ['autodocs'],
		parameters: { layout: 'padded' },
		args: {
			href: '#',
			id: 'band-1',
			name: 'The Velvet Underground',
			memberCount: 4,
			tagline: 'Art rock from the basement'
		}
	});
</script>

<Story name="Default" />
<Story name="Looking for members" args={{ lookingForMembers: true }} />
<Story name="Custom color" args={{ color: 'var(--cmc-teal)', name: 'Sonic Youth' }} />
