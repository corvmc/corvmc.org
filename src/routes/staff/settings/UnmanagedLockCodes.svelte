<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	// Type-0 lock users the site does not account for: standing door codes made
	// by hand in the U-tec app, which nothing revoked when someone stopped being
	// a member. Adopting one changes nothing on the lock — it starts tracking it
	// and reads the code back, so staff can tell a member theirs without
	// resetting it.
	//
	// No bulk action here on purpose: each one opens the building for a real
	// person, and the wrong one revoked locks somebody out.
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import {
		getUnmanagedLockUsers,
		adoptUnmanagedCode,
		getMemberCodes
	} from '$lib/remote/lock.remote';

	let busyId = $state<number | null>(null);
	let failure = $state<string | null>(null);

	const unmanaged = $derived(await getUnmanagedLockUsers());

	async function adopt(lockAccessId: number, label: string) {
		busyId = lockAccessId;
		failure = null;
		try {
			// No member attached yet: staff can say "this code is accounted for"
			// before they have worked out whose it is.
			await adoptUnmanagedCode({ lockAccessId, label, userId: null });
			await Promise.all([getUnmanagedLockUsers().refresh(), getMemberCodes().refresh()]);
		} catch (err) {
			failure = (err as Error).message;
		} finally {
			busyId = null;
		}
	}
</script>

<div class="mt-2 border-t border-base-200 pt-3">
	<p class="text-sm font-medium">{m.staff_settings_unmanaged_lock_codes_unmanaged_door_codes()}</p>
	<p class="text-subtle">
		{m.staff_settings_unmanaged_lock_codes_standing_codes_lock_site()}
	</p>

	{#if failure}
		<Alert type="error" class="mt-2">{failure}</Alert>
	{/if}

	{#if unmanaged.length === 0}
		<p class="mt-2 text-subtle">
			{m.staff_settings_unmanaged_lock_codes_every_standing_code_lock()}
		</p>
	{:else}
		<ul class="mt-2 divide-y divide-base-200">
			{#each unmanaged as u (u.lockAccessId)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2">
					<div class="flex items-center gap-2">
						<span class="font-medium">{u.label}</span>
						{#if !u.synced}
							<Badge variant="warning">{m.staff_settings_unmanaged_lock_codes_not_lock_yet()}</Badge
							>
						{/if}
					</div>
					<div class="flex shrink-0 gap-2">
						<Button
							type="button"
							variant="default"
							size="sm"
							outline
							disabled={busyId === u.lockAccessId}
							onclick={() => adopt(u.lockAccessId, u.label)}
						>
							{m.staff_settings_unmanaged_lock_codes_adopt()}
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
