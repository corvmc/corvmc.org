<script lang="ts">
	// Type-0 lock users the site does not account for.
	//
	// Seventeen of these existed when the integration was audited: standing door
	// codes created by hand in the U-tec app, which nothing revoked when someone
	// stopped being a member. Adopting one changes nothing on the lock — it just
	// starts tracking it, and reads the code back so staff can tell the member
	// what theirs is without resetting it.
	//
	// There is no bulk action here on purpose. Each of these opens the building
	// for a real person, and the wrong one revoked locks somebody out of their
	// band practice.
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
	<p class="text-sm font-medium">Unmanaged door codes</p>
	<p class="text-subtle">
		Standing codes on the lock that this site does not track. Adopting one changes nothing at the
		door — it starts tracking it, which is what makes revoking it possible at all.
	</p>

	{#if failure}
		<Alert type="error" class="mt-2">{failure}</Alert>
	{/if}

	{#if unmanaged.length === 0}
		<p class="mt-2 text-subtle">Every standing code on the lock is accounted for.</p>
	{:else}
		<ul class="mt-2 divide-y divide-base-200">
			{#each unmanaged as u (u.lockAccessId)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2">
					<div class="flex items-center gap-2">
						<span class="font-medium">{u.label}</span>
						{#if !u.synced}
							<Badge variant="warning">Not on the lock yet</Badge>
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
							Adopt
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
