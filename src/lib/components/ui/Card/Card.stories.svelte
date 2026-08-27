<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CardHarness from './CardHarness.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Card',
		component: CardHarness,
		tags: ['autodocs']
	});
</script>

<Story name="Default" />
<Story name="Bordered" args={{ bordered: true }} />
<Story name="Base 200" args={{ tone: 'base-200' }} />
<Story name="Row body" args={{ row: true }} />
<Story name="Tight padding" args={{ padding: 'sm' }} />
<Story name="Centred body" args={{ center: true }} />
<Story name="Small title" args={{ size: 'base' }} />
