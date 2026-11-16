<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import IfHeld from '../IfHeld.svelte';
	import BandList from './BandList.svelte';
</script>

<PageHeader title={m.staff_bands_title()}>
	<!-- Outside acts are Contacts' performer role (#2765), kept a click from bands. -->
	<IfHeld cap="contact.read">
		<Button href={withQuery(resolve('/staff/contacts'), 'role=performer')} variant="ghost">
			{m.staff_bands_outside_acts_label()}
		</Button>
	</IfHeld>
</PageHeader>

<PageContent>
	<BandList />
</PageContent>
