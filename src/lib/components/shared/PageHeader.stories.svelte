<script module lang="ts">
	import Button from './Button.svelte';
	import type { ComponentProps } from 'svelte';
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PageHeader from './PageHeader.svelte';

	const { Story } = defineMeta({
		title: 'Shared/PageHeader',
		component: PageHeader,
		tags: ['autodocs'],
		// The sticky negative-margin header reads best against a padded surface.
		parameters: { layout: 'padded' }
	});
</script>

{#snippet actionsTemplate(args: ComponentProps<typeof PageHeader>)}
	<PageHeader {...args}>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static demo href in a story -->
		<Button href="/member/bands/new" variant="primary" size="sm">New band</Button>
	</PageHeader>
{/snippet}

<!-- Several actions must stay grouped opposite the title, not spread across the header. -->
{#snippet manyActionsTemplate(args: ComponentProps<typeof PageHeader>)}
	<PageHeader {...args}>
		<Button variant="ghost" size="sm">Interests</Button>
		<Button variant="ghost" size="sm">Profile</Button>
		<Button variant="primary" size="sm">Log Hours</Button>
	</PageHeader>
{/snippet}

<Story name="Title only" args={{ title: 'Reservations' }} />
<Story name="With subtitle" args={{ title: 'Reservations', subtitle: 'Member' }} />
<Story
	name="With back link"
	args={{ title: 'Edit band', subtitle: 'Band', backHref: '/member/bands' }}
/>
<Story
	name="With actions"
	args={{ title: 'Bands', subtitle: 'Member' }}
	template={actionsTemplate}
/>

<Story
	name="With several actions"
	args={{ title: 'Volunteering', subtitle: 'Member' }}
	template={manyActionsTemplate}
/>
