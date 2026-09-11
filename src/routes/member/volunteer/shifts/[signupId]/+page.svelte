<script lang="ts">
	/**
	 * The volunteer's own shift, on the night.
	 *
	 * Everything here was staff-only until #934 and #931. Authorisation is the
	 * signup rather than a capability: being rostered on the work is the right
	 * predicate for recording that the work is done.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import ShiftProgress from '$lib/components/volunteer/ShiftProgress.svelte';
	import { goto } from '$app/navigation';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { formatDateLong, formatTimeRange } from '$lib/utils/format';
	import { getMyShift, setMyWorkTaskDone, cancelMySignup } from '$lib/remote/volunteer.remote';

	const signupId = $derived(page.params.signupId!);
	const data = $derived(await getMyShift(signupId));

	const doneCount = $derived(data.tasks.filter((t) => t.done).length);
	const calledOff = $derived(!!data.shift.shiftCancelledAt || !!data.shift.cancelledAt);
</script>

<PageHeader
	title={data.shift.roleName}
	subtitle={data.shift.eventTitle ?? 'Volunteer shift'}
	backHref={resolve('/member/volunteer')}
/>
<PageContent width="2xl">
	{#if calledOff}
		<Alert type="warning">
			{data.shift.shiftCancelledAt
				? 'This shift was called off. There is nothing to turn up for.'
				: 'You dropped out of this shift.'}
		</Alert>
	{/if}

	<InfoCard title="When">
		<p class="font-medium">
			{#if data.shift.startsAt && data.shift.endsAt}
				{formatDateLong(data.shift.startsAt)} · {formatTimeRange(
					data.shift.startsAt,
					data.shift.endsAt
				)}
			{:else}
				A time still to be arranged.
			{/if}
		</p>
		{#if data.shift.notes}
			<p class="mt-2 text-muted">{data.shift.notes}</p>
		{/if}

		<!-- The rail the card on /member/volunteer shows. `status` was loaded here
		     and rendered nowhere, so opening a shift told you less about where it
		     stood than the row you clicked (#1066). -->
		{#if !calledOff}
			<div class="mt-3">
				<ShiftProgress status={data.shift.status} notes={null} />
			</div>
		{/if}
	</InfoCard>

	{#if data.checkIn && !calledOff}
		<InfoCard title="On the door">
			<p class="text-muted">Mark people arrived as they come in. The list is this show's only.</p>
			<div class="mt-3">
				<Button
					href={resolve(`/member/volunteer/shifts/${signupId}/check-in`)}
					variant="primary"
					size="sm"
				>
					Check people in
				</Button>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title="Checklist">
		{#snippet header(title)}
			<CardTitle>
				{title}
				{#if data.tasks.length > 0}
					<span class="text-muted font-normal">· {doneCount} of {data.tasks.length}</span>
				{/if}
			</CardTitle>
		{/snippet}

		{#if data.tasks.length === 0}
			<EmptyState message="Nothing on the list for this shift." />
		{:else}
			<!-- Ticking submits on change: a checklist behind a Save button is a
			     checklist people forget to save. -->
			<ul class="flex flex-col gap-1">
				{#each data.tasks as task (task.id)}
					<li>
						<Form
							remote={setMyWorkTaskDone.for(task.id)}
							onchange={(e: Event) => (e.currentTarget as HTMLFormElement).requestSubmit()}
						>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="signupId" value={signupId} />
							<FormField
								name="done"
								type="checkbox"
								checkboxLabel={task.label}
								value={task.done}
								disabled={calledOff}
								class={task.done ? 'text-subtle line-through' : ''}
							/>
						</Form>
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>

	<!-- Both of these were on the card and absent here. A page you open to work
	     a shift from should be able to do what the row that linked to it could
	     (#1066). -->
	<div class="flex flex-wrap gap-2">
		{#if data.shift.status === 'completed'}
			<Button
				href={resolve(`/member/volunteer/feedback/${signupId}`)}
				variant="default"
				size="sm"
				outline
			>
				How did it go?
			</Button>
		{:else if !calledOff}
			<Action
				action={cancelMySignup.for(signupId)}
				label="Drop out"
				variant="ghost"
				size="sm"
				modalTitle="Drop out of this shift?"
				submitLabel="Drop out"
				successToast="Dropped. The place is back on the board."
				onsuccess={() => goto(resolve('/member/volunteer'))}
			>
				{#snippet form()}
					<input type="hidden" name="signupId" value={signupId} />
					<p class="text-sm">
						Notice isn't a no-show. The place goes back on the board for someone else, and nothing
						is held against you for telling us.
					</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
