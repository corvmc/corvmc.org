<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Badge from './Badge.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Badge',
		component: Badge,
		tags: ['autodocs']
	});
</script>

<Story name="Primary" args={{ variant: 'primary' }}>Primary</Story>
<Story name="Secondary" args={{ variant: 'secondary' }}>Secondary</Story>
<Story name="Success" args={{ variant: 'success' }}>Success</Story>
<Story name="Error" args={{ variant: 'error' }}>Error</Story>
<Story name="Warning" args={{ variant: 'warning' }}>Warning</Story>
<Story name="Info" args={{ variant: 'info' }}>Info</Story>
<Story name="Outline" args={{ variant: 'outline' }}>Outline</Story>
<Story name="Ghost" args={{ variant: 'ghost' }}>Ghost</Story>
<Story name="Extra small" args={{ variant: 'primary', size: 'xs' }}>xs</Story>
<Story name="Large" args={{ variant: 'primary', size: 'lg' }}>Large</Story>
