<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Avatar from './Avatar.svelte';

	// Avatar uses container-query sizing (font-size: 50cqmin), so a story must give
	// it an explicit box size via the class prop.
	const { Story } = defineMeta({
		title: 'Shared/Avatar',
		component: Avatar,
		tags: ['autodocs'],
		args: { class: 'size-16' }
	});
</script>

<Story name="Initials" args={{ name: 'Jane Doe' }} />
<Story name="Single name" args={{ name: 'Prince' }} />
<Story name="Small" args={{ name: 'Jane Doe', class: 'size-8' }} />
<Story name="Large" args={{ name: 'Jane Doe', class: 'size-28' }} />
<Story
	name="With photo"
	args={{ name: 'Jane Doe', src: 'https://i.pravatar.cc/200?img=5', class: 'size-16' }}
/>
