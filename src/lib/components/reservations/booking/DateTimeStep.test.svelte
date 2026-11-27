<!-- Test harness for DateTimeStep: the step needs the form context a booking form gives it. -->
<script lang="ts">
	import * as Form from '#lib/components/ui/Form/index.js';
	import type { RemoteForm } from '$app/server';
	import type { BookerType } from '#lib/config.js';
	import DateTimeStep from './DateTimeStep.svelte';

	let {
		remote,
		bookerType,
		prefill
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a mocked remote form
		remote: RemoteForm<any, any>;
		bookerType?: BookerType;
		prefill?: { date: string; startTime: string; endTime: string };
	} = $props();
</script>

<Form.Root {remote}>
	<DateTimeStep isSustaining {bookerType} {prefill} />
</Form.Root>
