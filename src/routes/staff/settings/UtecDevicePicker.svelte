<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// The Device ID, picked from the account rather than typed. Its own
	// component so the settings page keeps one load-bearing query — this one
	// talks to U-tec over the network, and only this tab wants it.
	//
	// Falls back to a text field whenever the list cannot be read, which is the
	// normal state of this page while the credentials are still wrong: the
	// stored id stays editable so the form is never a dead end.
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { getUtecDevices } from '$lib/remote/settings.remote';

	let { deviceId }: { deviceId: string } = $props();

	const result = $derived(await getUtecDevices());
	const options = $derived(
		result.devices.map((d) => ({
			value: d.id,
			label: d.category ? `${d.name} · ${d.category}` : d.name
		}))
	);
</script>

{#if options.length > 0}
	<FormField
		name="deviceId"
		label={m.staff_settings_utec_device_picker_device()}
		type="select"
		value={deviceId}
		{options}
	/>
{:else}
	<FormField
		name="deviceId"
		label={m.staff_settings_utec_device_picker_device_id()}
		type="text"
		value={deviceId}
		description={result.error ?? m.staff_settings_utec_device_picker_description()}
	/>
{/if}
