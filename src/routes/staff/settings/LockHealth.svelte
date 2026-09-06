<script lang="ts">
	// Whether the door is actually reachable, and the break-glass code.
	//
	// Its own component so the settings page keeps one load-bearing query: this
	// one talks to U-tec over the network and nothing above the fold needs it, so
	// it loads lazily behind its own boundary rather than fanning out alongside
	// `getStaffSettingsPage()`.
	//
	// The page's "Connected" badge means only that a refresh token is stored. This
	// is the part that says whether a door code will actually work.
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getLockHealth, rotateFallbackCode } from '$lib/remote/lock.remote';

	const health = $derived(await getLockHealth());

	let rotating = $state(false);
	let rotateResult = $state<{ ok: boolean; error?: string } | null>(null);

	async function handleRotate() {
		rotating = true;
		rotateResult = null;
		try {
			rotateResult = await rotateFallbackCode();
			await getLockHealth().refresh();
		} catch (err) {
			rotateResult = { ok: false, error: (err as Error).message };
		} finally {
			rotating = false;
		}
	}
</script>

<div class="mt-2 border-t border-base-200 pt-3">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-sm font-medium">Lock</span>
		{#if !health.ok}
			<Badge variant="error">Unreachable</Badge>
			<span class="text-subtle">{health.error}</span>
		{:else if health.online}
			<Badge variant="success">Online</Badge>
			<span class="text-subtle">
				{health.lockState ?? 'unknown'} · battery {health.batteryLevel ?? '?'}/5
			</span>
		{:else}
			<Badge variant="warning">Offline</Badge>
			<span class="text-subtle">
				Door codes are queued and will not work until it reconnects. Last known:
				{health.lockState ?? 'unknown'} · battery {health.batteryLevel ?? '?'}/5
			</span>
		{/if}
	</div>

	{#if health.ok}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<span class="text-subtle">Break-glass code</span>
			{#if health.fallbackCode}
				<span class="font-mono font-bold tracking-[0.2em]">{health.fallbackCode}</span>
				<Button type="button" variant="ghost" size="sm" onclick={handleRotate} disabled={rotating}>
					Rotate
				</Button>
			{:else}
				<span class="text-subtle">
					None confirmed on the lock yet — one is minted by the daily job.
				</span>
			{/if}
		</div>
		{#if rotateResult}
			<p class="mt-1 text-subtle">
				{rotateResult.ok
					? 'A replacement is on its way to the lock. The current code keeps working until it lands.'
					: rotateResult.error}
			</p>
		{/if}
	{/if}
</div>
