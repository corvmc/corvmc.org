<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Alert from './Alert.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Alert',
		component: Alert,
		tags: ['autodocs']
	});
</script>

<Story name="Info" args={{ type: 'info' }}>Heads up — your profile is incomplete.</Story>
<Story name="Success" args={{ type: 'success' }}>Your reservation is confirmed.</Story>
<Story name="Warning" args={{ type: 'warning' }}>Your membership renews in 3 days.</Story>
<Story name="Error" args={{ type: 'error' }}>We couldn't process your payment.</Story>
<Story name="With retry" args={{ type: 'error', reset: () => {} }}
	>Something went wrong loading shows.</Story
>

<!--
	The alert body is flow content, not a single paragraph: a heading line over a
	paragraph, or a list, has to stack inside the box. `.alert` lays its direct
	children out as grid columns, so this only holds together while the component
	keeps them in one wrapper.
-->
<Story name="With structured content" args={{ type: 'warning' }}>
	<strong>Staff didn't publish this listing.</strong>
	<p class="mt-1">"The date is in the past."</p>
	<p class="mt-1">Fix it below and submit it again — everything you entered is still here.</p>
</Story>

<Story name="With a list" args={{ type: 'warning' }}>
	<p class="font-semibold">3 record(s) had issues:</p>
	<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm">
		<li><span class="badge badge-ghost badge-sm">user</span> no matching subscription</li>
		<li><span class="badge badge-ghost badge-sm">band</span> missing contact email</li>
		<li><span class="badge badge-ghost badge-sm">credit</span> balance drifted by 2 hours</li>
	</ul>
</Story>
