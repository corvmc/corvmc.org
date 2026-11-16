<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { pageTitle } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import ErrorToastBoundary from '#lib/components/ui/ErrorToastBoundary.svelte';
	import {
		getBackDoor,
		openBackDoor,
		checkOutBackDoor,
		reportOfflineReveal
	} from '#lib/remote/back-door.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { formatTime, relativeDay } from '#lib/utils/format.js';

	// Everything a timed-out unlock needs is already in this page's data, so a
	// phone with no signal at the door can still show the code (#2157). A reveal
	// that could not reach the server is remembered and reported once it can.
	type Outcome = 'unlocked' | 'locked' | 'timed_out' | 'lock_offline';
	const PENDING_KEY = 'door:pendingReveal';

	let busy = $state<'open' | 'close' | null>(null);
	let opened = $state<Outcome | null>(null);
	let closed = $state<Outcome | null>(null);
	let revealedCode = $state<string | null>(null);
	let leaving = $state(false);
	let failure = $state<string | null>(null);

	function remember(id: string) {
		try {
			localStorage.setItem(PENDING_KEY, id);
		} catch {
			// Nothing else to do; the code still shows.
		}
	}

	async function flushPending() {
		let id: string | null;
		try {
			id = localStorage.getItem(PENDING_KEY);
		} catch {
			return;
		}
		if (!id) return;
		try {
			await reportOfflineReveal(id);
			localStorage.removeItem(PENDING_KEY);
		} catch {
			// Still offline; the next load or `online` event tries again.
		}
	}

	onMount(() => {
		void flushPending();
		window.addEventListener('online', flushPending);
		return () => window.removeEventListener('online', flushPending);
	});

	/** A thrown TypeError is fetch failing: no signal, not a refusal. */
	const offline = (err: unknown) =>
		err instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);

	const door = $derived(await getBackDoor());
	const code = $derived(revealedCode ?? (door.codeRevealed ? door.code : null));
	const failedToOpen = $derived(opened === 'timed_out' || opened === 'lock_offline');

	async function open(id: string) {
		busy = 'open';
		failure = null;
		try {
			const result = await openBackDoor(id);
			opened = result.outcome;
			revealedCode = result.code;
		} catch (err) {
			if (!offline(err)) {
				failure = errorMessage(err);
				return;
			}
			opened = 'timed_out';
			revealedCode = door.code;
			remember(id);
		} finally {
			busy = null;
		}
	}

	async function close(id: string) {
		busy = 'close';
		failure = null;
		try {
			closed = (await checkOutBackDoor(id)).outcome;
		} catch (err) {
			if (!offline(err)) {
				failure = errorMessage(err);
				return;
			}
			closed = 'timed_out';
		} finally {
			busy = null;
			leaving = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle('Back door')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ErrorToastBoundary>
	<div class="flex items-center justify-center px-4 py-10">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					<CardTitle size="lg" level={2} class="justify-center">{m.public_door_title()}</CardTitle>

					{#if failure}
						<Alert type="error">{failure}</Alert>
					{/if}

					{#if !door.booking}
						<p class="text-center">{m.public_door_no_booking_text()}</p>
						{#if door.next}
							<p class="text-center text-subtle">
								{m.public_door_next_opens_text({
									day: relativeDay(door.next.opensAt),
									time: formatTime(door.next.opensAt)
								})}
							</p>
						{:else}
							<Button variant="primary" href={resolve('/member/reservations')}>
								{m.public_door_book_label()}
							</Button>
						{/if}
					{:else}
						{@const booking = door.booking}
						<p class="text-center">
							{#if booking.bandName}<strong>{booking.bandName}</strong> ·{/if}
							{formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}
						</p>

						{#if closed || door.checkedOutAt}
							{#if closed === 'locked'}
								<Alert type="success">{m.public_door_locked_body()}</Alert>
							{:else if closed}
								<Alert type="warning">
									{m.public_door_lock_unconfirmed_body()}
								</Alert>
							{/if}
							<p class="text-center text-subtle">{m.public_door_checked_out_text()}</p>
						{:else}
							{#if opened === 'unlocked'}
								<Alert type="success">{m.public_door_open_body()}</Alert>
							{/if}

							{#if code}
								<div class="text-center">
									{#if opened === 'lock_offline'}
										<p>{m.public_door_lock_offline_text()}</p>
									{:else if opened === 'timed_out'}
										<p>{m.public_door_timed_out_text()}</p>
									{/if}
									<p class="font-mono text-4xl font-bold tracking-[0.3em]">{code}</p>
									<p class="text-subtle">
										{m.public_door_keypad_text()}
									</p>
								</div>
							{:else if failedToOpen}
								<Alert type="warning">{m.public_door_no_code_call_staff_body()}</Alert>
							{:else if door.poolEmpty}
								<p class="text-center text-subtle">
									{m.public_door_no_backup_text()}
								</p>
							{/if}

							{#if leaving}
								<div>
									<p class="font-medium">{m.public_door_before_you_go_text()}</p>
									<ul class="list-disc pl-5">
										{#each door.checkoutTasks as task (task)}
											<li>{task}</li>
										{/each}
									</ul>
								</div>
								<Button
									variant="primary"
									disabled={busy !== null}
									onclick={() => close(booking.id)}
								>
									{busy === 'close'
										? m.public_door_locking_label()
										: m.public_door_check_out_submit_label()}
								</Button>
								<Button variant="ghost" onclick={() => (leaving = false)}>
									{m.public_door_not_yet_label()}
								</Button>
							{:else}
								<Button variant="primary" disabled={busy !== null} onclick={() => open(booking.id)}>
									{busy === 'open'
										? m.public_door_opening_label()
										: door.checkedInAt
											? m.public_door_open_door_label()
											: m.public_door_check_in_label()}
								</Button>
								{#if door.checkedInAt}
									<Button variant="ghost" disabled={busy !== null} onclick={() => (leaving = true)}>
										{m.public_door_check_out_label()}
									</Button>
								{/if}
							{/if}
						{/if}
					{/if}
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
