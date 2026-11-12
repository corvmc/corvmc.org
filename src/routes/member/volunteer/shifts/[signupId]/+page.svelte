<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The volunteer's own shift, on the night.
	 *
	 * Everything here was staff-only until #934 and #931. Authorisation is the
	 * signup rather than a capability: being rostered on the work is the right
	 * predicate for recording that the work is done.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import ShiftProgress from '#lib/components/volunteer/ShiftProgress.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import FileIncidentAction from './FileIncidentAction.svelte';
	import { goto } from '$app/navigation';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { resolve } from '$app/paths';
	import { formatDateLong, formatDateTime, formatTimeRange } from '#lib/utils/format.js';
	import { incidentCategoryLabels } from '#lib/config.js';
	import { getMyShift, setMyWorkTaskDone, cancelMySignup } from '#lib/remote/volunteer.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';
	import { shiftLabel, shiftRoleSuffix } from '#lib/utils/shift-label.js';

	const params = routeParams('signupId');

	const signupId = $derived(params.signupId);
	const data = $derived(await getMyShift(signupId));

	const doneCount = $derived(data.tasks.filter((t) => t.done).length);
	const calledOff = $derived(!!data.shift.shiftCancelledAt || !!data.shift.cancelledAt);
</script>

<PageHeader
	width="2xl"
	title={shiftLabel(data.shift)}
	subtitle={shiftRoleSuffix(data.shift) ??
		data.shift.eventTitle ??
		m.member_volunteer_shifts_signup_id_subtitle_body()}
/>
<PageContent width="2xl">
	{#if calledOff}
		<Alert type="warning">
			{data.shift.shiftCancelledAt
				? m.member_volunteer_shifts_signup_id_shift_was_called_off_there_body()
				: m.member_volunteer_shifts_signup_id_dropped_out_shift_body()}
		</Alert>
	{/if}

	<!--
		The night this shift belongs to, as the record it is rather than a string
		in the subtitle. A volunteer who wants to know what they signed up for had
		the event's name and no way to reach it.
	-->
	{#if data.event}
		<Card>
			<CardBody>
				<EntityIdentity ref={data.event} size="md" status />
			</CardBody>
		</Card>
	{/if}

	<InfoCard title={m.member_when_title()}>
		<p class="font-medium">
			{formatDateLong(data.shift.startsAt)} · {formatTimeRange(
				data.shift.startsAt,
				data.shift.endsAt
			)}
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
		<InfoCard title={m.member_volunteer_shifts_signup_id_door_title()}>
			<p class="text-muted">
				{m.member_volunteer_shifts_signup_id_mark_people_arrived_as_the_text()}
			</p>
			<div class="mt-3">
				<Button
					href={resolve(`member/volunteer/shifts/${signupId}/check-in`)}
					variant="primary"
					size="sm"
				>
					{m.member_volunteer_shifts_signup_id_check_people_label()}
				</Button>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title={m.member_volunteer_shifts_signup_id_checklist_title()}>
		{#snippet header(title)}
			<CardTitle>
				{title}
				{#if data.tasks.length > 0}
					<span class="text-muted font-normal"
						>{m.member_volunteer_shifts_signup_id_text_title({
							doneCount,
							length: data.tasks.length
						})}</span
					>
				{/if}
			</CardTitle>
		{/snippet}

		{#if data.tasks.length === 0}
			<EmptyState message={m.member_volunteer_shifts_signup_id_message_body()} />
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
							<input {...setMyWorkTaskDone.for(task.id).fields.id.as('hidden', task.id)} />
							<input {...setMyWorkTaskDone.for(task.id).fields.signupId.as('hidden', signupId)} />
							<FormField
								field={setMyWorkTaskDone.for(task.id).fields.done}
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

	{#if data.incidentEventId}
		<InfoCard
			title={m.member_volunteer_shifts_signup_id_incidents_title()}
			state={data.filedIncidents.length}
		>
			{#snippet action()}
				<FileIncidentAction eventId={data.incidentEventId!} {signupId} />
			{/snippet}
			{#if data.filedIncidents.length === 0}
				<p class="text-muted">
					{m.member_volunteer_shifts_signup_id_if_something_goes_wrong_ni_text()}
				</p>
			{:else}
				<ul class="flex flex-col gap-3">
					{#each data.filedIncidents as i (i.id)}
						<li>
							<div class="flex items-center gap-2">
								<StatusBadge status={i.status} label />
								<span class="font-medium">{i.summary}</span>
							</div>
							<div class="text-subtle">
								{incidentCategoryLabels[i.category]} · {formatDateTime(i.occurredAt)}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	<!-- Both of these were on the card and absent here. A page you open to work
	     a shift from should be able to do what the row that linked to it could
	     (#1066). -->
	<div class="flex flex-wrap gap-2">
		{#if data.shift.status === 'completed'}
			<Button
				href={resolve(`member/volunteer/feedback/${signupId}`)}
				variant="default"
				size="sm"
				outline
			>
				{m.member_how_did_go_label()}
			</Button>
		{:else if !calledOff}
			<Action
				action={cancelMySignup.for(signupId)}
				label={m.member_volunteer_shifts_signup_id_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.member_volunteer_shifts_signup_id_modal_title()}
				submitLabel={m.member_volunteer_shifts_signup_id_label()}
				successToast={m.member_volunteer_shifts_signup_id_success_toast()}
				onsuccess={() => goto(resolve('member/volunteer'))}
			>
				{#snippet form()}
					<input {...cancelMySignup.for(signupId).fields.signupId.as('hidden', signupId)} />
					<p class="text-sm">
						{m.member_volunteer_shifts_signup_id_notice_isn_t_no_show_text()}
					</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
