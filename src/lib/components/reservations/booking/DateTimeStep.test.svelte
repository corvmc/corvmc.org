<!-- Test harness for DateTimeStep: the step needs the form context a booking form gives it. -->
<script lang="ts">
	import * as Form from '#lib/components/ui/Form/index.js';
	import type { RemoteForm } from '$app/server';
	import type { BookerType } from '#lib/config.js';
	import DateTimeStep from './DateTimeStep.svelte';

	let {
		remote,
		bookerType
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a mocked remote form
		remote: RemoteForm<any, any>;
		bookerType?: BookerType;
	} = $props();
</script>

<Form.Root {remote}>
	<DateTimeStep isSustaining {bookerType} />
</Form.Root>
