<script lang="ts">
	// Whether the door is actually reachable. Door codes are on Key Holders.
	//
	// Its own component so the settings page keeps one load-bearing query: this
	// one talks to U-tec over the network and nothing above the fold needs it,
	// so it loads lazily behind its own boundary.
	//
	// The page's "Connected" badge means only that a refresh token is stored;
	// this says whether a door code will actually work.
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getLockHealth, runLockJobNow } from '$lib/remote/lock.remote';
	import { timeAgo } from '$lib/utils/format';

	const health = $derived(await getLockHealth());

	let running = $state(false);
	let runError = $state<string | null>(null);

	// Safe to press twice: every stage of the job is filtered on work still
	// outstanding, so a repeat run reports zeros rather than issuing a code again.
	async function handleRun() {
		running = true;
		runError = null;
		try {
			await runLockJobNow();
			await getLockHealth().refresh();
		} catch (err) {
			runError = (err as Error).message;
		} finally {
			running = false;
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

	<div class="mt-3 flex flex-wrap items-center gap-2">
		<span class="text-subtle">Daily job</span>
		{#if health.lastRun}
			{#if health.lastRun.errors.length > 0}
				<Badge variant="error">
					{health.lastRun.errors.length}
					{health.lastRun.errors.length === 1 ? 'error' : 'errors'}
				</Badge>
			{:else}
				<Badge variant="success">Clean</Badge>
			{/if}
			<span class="text-subtle">
				{timeAgo(new Date(health.lastRun.at))} ·
				{health.lastRun.triggeredBy ?? 'scheduled'} ·
				{health.lastRun.provisioned} provisioned, {health.lastRun.cleaned} cleaned,
				{health.lastRun.confirmed} confirmed
				{#if health.lastRun.pool}
					· {health.lastRun.pool.available} door codes ready
				{/if}
			</span>
		{:else}
			<span class="text-subtle">Never run, or not since this was added.</span>
		{/if}
		<Button type="button" variant="ghost" size="sm" onclick={handleRun} disabled={running}>
			{running ? 'Running…' : 'Run now'}
		</Button>
	</div>

	{#if health.lastRun?.errors.length}
		<ul class="mt-1 list-disc pl-5 text-subtle">
			{#each health.lastRun.errors as message, i (i)}
				<li>{message}</li>
			{/each}
		</ul>
	{/if}

	{#if runError}
		<p class="mt-1 text-error">{runError}</p>
	{/if}
</div>
