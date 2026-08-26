<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityAvatar from './EntityAvatar.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Directory/EntityAvatar',
		component: EntityAvatar,
		tags: ['autodocs'],
		args: { class: 'size-20' }
	});
</script>

<Story name="Member (round)" args={{ name: 'Jane Doe', shape: 'round' }} />
<Story name="Band (square)" args={{ name: 'The Velvet Underground', shape: 'square' }} />
<Story
	name="With photo"
	args={{ name: 'Jane Doe', shape: 'round', image: 'https://i.pravatar.cc/200?img=12' }}
/>
