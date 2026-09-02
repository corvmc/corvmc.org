<script lang="ts">
	/**
	 * Daily — one thread, one decision, no list scanning.
	 *
	 * Outside the two-pane layout on purpose: the queue is a list you scan and
	 * this is the opposite of that. The three states (start card, session,
	 * summary) are one route because they are one activity, and a session that
	 * navigated between them would put its own progress in the back button.
	 *
	 * Every part below the session bar is the queue's, unchanged —
	 * `ThreadTimeline`, `DetailsPanel`, `DispositionBar` in its focus variant.
	 * That is the constraint the component inventory sets: a primitive must
	 * behave identically here and in the queue.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconArrowDown, IconX } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';
	import DispositionBar from '$lib/components/inbox/DispositionBar.svelte';
	import { getInboxDailyScope, getInboxThread } from '$lib/remote/inbox.remote';
	import { useShortcut } from '$lib/useShortcut.svelte';
	import { waitingDays } from '$lib/components/inbox/thread-status';
	import { channelLabel } from '$lib/components/inbox/channels';
	import { session, doneToday, markDoneToday } from './session.svelte';
	import DailyStartCard from './DailyStartCard.svelte';
	import SessionSummary from './SessionSummary.svelte';

	// The page's one load-bearing query. Each thread is fetched as the session
	// reaches it — seven small reads spread through the session rather than one
	// large one before it starts.
	const scope = $derived(await getInboxDailyScope());

	// Esc leaves. A session is not a place you should have to find your way out
	// of, and the browser back button would land you mid-session on a reload.
	useShortcut(
		() => 'escape',
		() => {
			if (session.started) leave();
		}
	);

	function leave() {
		session.end();
		void goto(resolve('/staff/inbox'));
	}

	function finish() {
		markDoneToday();
	}
</script>

<div class="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4 py-6">
	{#if !session.started}
		{#if scope.threadIds.length === 0}
			<EmptyState
				title="Nothing to triage"
				description="The queue is clear. Daily has nothing to walk you through."
			/>
			<div class="flex justify-center">
				<Button href={resolve('/staff/inbox')} variant="default">Back to inbox</Button>
			</div>
		{:else}
			<DailyStartCard
				{scope}
				alreadyDone={doneToday()}
				onstart={() => session.start(scope)}
				oncancel={leave}
			/>
		{/if}
	{:else if session.finished}
		<SessionSummary
			onclose={() => {
				finish();
				leave();
			}}
		/>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-baseline gap-3">
				<h1 class="text-xl font-bold">Daily</h1>
				<span class="text-muted text-sm">{session.position} of {session.total}</span>
			</div>
			<Button variant="ghost" size="sm" onclick={leave}>
				<IconX size={16} /> Esc to exit
			</Button>
		</div>

		{#key session.currentId}
			{#await getInboxThread(session.currentId!)}
				<div class="flex flex-1 items-center justify-center">
					<span class="loading loading-spinner"></span>
				</div>
			{:then t}
				<Card>
					<CardBody class="gap-4">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<h2 class="text-lg font-bold">
								{t.contactUserName ?? t.contactName ?? t.contactEmail ?? 'Conversation'}
							</h2>
							<!-- The age line is the pressure signal, and in Daily it is the
							     only context on screen — there is no list beside it saying
							     how this thread compares to the rest. -->
							<p class="text-muted text-sm">
								{t.subject ?? channelLabel(t.channel)} · waiting {waitingDays(t)} day{waitingDays(
									t
								) === 1
									? ''
									: 's'}
							</p>
						</div>

						<div class="max-h-96 overflow-y-auto">
							<ThreadTimeline messages={t.messages} notes={t.notes} contactName={t.contactName} />
						</div>

						{#if t.awaitingReplySince}
							<p class="text-subtle text-sm">
								No response since {new Date(t.awaitingReplySince).toLocaleDateString()}
							</p>
						{/if}

						<!-- Reply and Assign hand control back to the surface, same as in
						     the queue. Here that surface is the thread page, because a
						     composer inside a one-at-a-time session is a second thing to
						     decide about before you can make the first decision. -->
						<DispositionBar
							threadId={t.id}
							status={t.status}
							awaiting={!!t.awaitingReplySince}
							variant="focus"
							onreply={() => goto(resolve(`/staff/inbox/${t.id}`))}
							onassign={() => goto(resolve(`/staff/inbox/${t.id}`))}
							ondisposed={(action) => session.dispose(action)}
						/>
					</CardBody>
				</Card>

				<div class="flex justify-center">
					<Button variant="ghost" size="sm" onclick={() => session.skip()}>
						<IconArrowDown size={16} /> Skip — stays open, moves to the end
					</Button>
				</div>
			{/await}
		{/key}
	{/if}
</div>
