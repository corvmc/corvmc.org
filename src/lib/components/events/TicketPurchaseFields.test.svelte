<!--
	Test harness for TicketPurchaseFields: the fields inside a remote form, as the
	public checkout page mounts them, so its submit button has a form context.
-->
<script lang="ts">
	import * as Form from '#lib/components/ui/Form/index.js';
	import type { ComponentProps } from 'svelte';
	import type { RemoteForm } from '$app/server';
	import TicketPurchaseFields from './TicketPurchaseFields.svelte';

	let {
		remote,
		...props
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a mocked remote form
		remote: RemoteForm<any, any>;
	} & Omit<ComponentProps<typeof TicketPurchaseFields>, 'fields'> = $props();
</script>

<Form.Root {remote}>
	<TicketPurchaseFields {...props} fields={remote.fields as never} />
</Form.Root>
