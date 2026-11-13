<!--
	Test harness for DateTimeField: a plain form, so a spec can read what the
	control would submit.
-->
<script lang="ts">
	import DateTimeField from './DateTimeField.svelte';

	let { oninput }: { oninput?: () => void } = $props();

	const hidden = (name: string) => ({
		as: (type: 'hidden', value: string) => ({ type, name, value })
	});
</script>

<form data-testid="harness" {oninput}>
	<DateTimeField
		date={hidden('eventDate')}
		time={hidden('eventStartTime')}
		dateValue="2026-11-13"
		timeValue="19:00"
		timeLabel="Start time"
	/>
</form>
