<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	// Whether the door is actually reachable, and the break-glass code.
	//
	// Its own component so the settings page keeps one load-bearing query: this
	// one talks to U-tec over the network and nothing above the fold needs it,
	// so it loads lazily behind its own boundary.
	//
	// The page's "Connected" badge means only that a refresh token is stored;
	// this says whether a door code will actually work.
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getLockHealth, rotateFallbackCode, runLockJobNow } from '#lib/remote/lock.remote.js';
	import { timeAgo } from '#lib/utils/format.js';

	const health = $derived(await getLockHealth());

	let rotating = $state(false);
	let rotateResult = $state<{ ok: boolean; error?: string } | null>(null);

	let running = $state(false);
	let runError = $state<string | null>(null);

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
		<span class="text-sm font-medium">{m.staff_settings_lock_health_lock_text()}</span>
		{#if !health.ok}
			<Badge variant="error">{m.staff_settings_lock_health_unreachable_label()}</Badge>
			<span class="text-subtle">{health.error}</span>
		{:else if health.online}
			<Badge variant="success">{m.staff_settings_lock_health_online_label()}</Badge>
			<span class="text-subtle">
				{m.staff_settings_lock_health_battery_5_text({
					lockState: health.lockState ?? m.staff_settings_lock_health_unknown_text(),
					value: health.batteryLevel ?? '?'
				})}
			</span>
		{:else}
			<Badge variant="warning">{m.staff_settings_lock_health_offline_label()}</Badge>
			<span class="text-subtle">
				{m.staff_settings_lock_health_door_codes_queued_will_not_text({
					lockState: health.lockState ?? m.staff_settings_lock_health_unknown_text(),
					value: health.batteryLevel ?? '?'
				})}
			</span>
		{/if}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-2">
		<span class="text-subtle">{m.staff_settings_lock_health_daily_job_text()}</span>
		{#if health.lastRun}
			{#if health.lastRun.errors.length > 0}
				<Badge variant="error">
					{health.lastRun.errors.length}
					{health.lastRun.errors.length === 1
						? m.staff_settings_lock_health_error_label()
						: m.staff_settings_lock_health_errors_label()}
				</Badge>
			{:else}
				<Badge variant="success">{m.staff_settings_lock_health_clean_label()}</Badge>
			{/if}
			<span class="text-subtle">
				{m.staff_settings_lock_health_provisioned_cleaned_confirmed_text({
					timeAgo: timeAgo(new Date(health.lastRun.at)),
					triggeredBy: health.lastRun.triggeredBy ?? m.staff_settings_lock_health_scheduled_text(),
					provisioned: health.lastRun.provisioned,
					cleaned: health.lastRun.cleaned,
					confirmed: health.lastRun.confirmed
				})}
			</span>
		{:else}
			<span class="text-subtle">{m.staff_settings_lock_health_never_run_not_since_was_text()}</span>
		{/if}
		<Button type="button" variant="ghost" size="sm" onclick={handleRun} disabled={running}>
			{running
				? m.staff_settings_lock_health_running_label()
				: m.staff_settings_lock_health_run_now_label()}
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

	{#if health.ok}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<span class="text-subtle">{m.staff_settings_lock_health_break_glass_code_text()}</span>
			{#if health.fallbackCode}
				<span class="font-mono font-bold tracking-[0.2em]">{health.fallbackCode}</span>
				<Button type="button" variant="ghost" size="sm" onclick={handleRotate} disabled={rotating}>
					{m.staff_settings_lock_health_rotate_label()}
				</Button>
			{:else}
				<span class="text-subtle">
					{m.staff_settings_lock_health_none_confirmed_lock_yet_one_text()}
				</span>
			{/if}
		</div>
		{#if rotateResult}
			<p class="mt-1 text-subtle">
				{rotateResult.ok
					? m.staff_settings_lock_health_replacement_its_way_lock_current_text()
					: rotateResult.error}
			</p>
		{/if}
	{/if}
</div>
