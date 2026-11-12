<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// Its own component so the page keeps one query of its own; the call dedupes
	// to the staff layout's. Door access is the lock card on Settings, which
	// needs `settings.read` to open and `lock.manage` to show the lock.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canLock = $derived(hasCapability(caps, 'lock.manage'));
</script>

{#if canLock}
	<Button variant="ghost" href={resolve('staff/keys')}
		>{m.staff_reservations_key_holders_label()}</Button
	>
	{#if hasCapability(caps, 'settings.read')}
		<Button variant="ghost" href="{resolve('staff/settings')}?tab=integrations"
			>{m.staff_reservations_door_access_label()}</Button
		>
	{/if}
{/if}
