<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import Button from './Button.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Button',
		component: Button,
		tags: ['autodocs'],
		args: { onclick: fn() }
	});
</script>

<Story name="Primary">Primary</Story>
<Story name="Secondary" args={{ variant: 'secondary' }}>Secondary</Story>
<Story name="Accent" args={{ variant: 'accent' }}>Accent</Story>
<Story name="Ghost" args={{ variant: 'ghost' }}>Ghost</Story>
<Story name="Default" args={{ variant: 'default' }}>Default</Story>
<Story name="Outline" args={{ outline: true }}>Outline</Story>
<Story name="Error" args={{ variant: 'error' }}>Delete</Story>
<Story name="Error outline" args={{ variant: 'error', outline: true }}>Delete</Story>
<Story name="Small" args={{ size: 'sm' }}>Small</Story>
<Story name="Large" args={{ size: 'lg' }}>Large</Story>
<Story name="Square" args={{ variant: 'ghost', size: 'sm', shape: 'square' }}>×</Story>
<Story name="Disabled" args={{ disabled: true }}>Disabled</Story>
