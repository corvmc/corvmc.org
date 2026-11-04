<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { formatDateTime } from '#lib/utils/format.js';
	import { incidentCategoryLabels } from '#lib/config.js';
	import {
		getIncidentDetail,
		getIncidentHistory,
		acceptIncidentForm,
		addIncidentNoteForm,
		resolveIncidentForm,
		reopenIncidentForm,
		setIncidentRetainForm
	} from '#lib/remote/incidents.remote.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';

	let id = $derived(page.params.id!);
	let incident = $derived(await getIncidentDetail(id));
	const canRecord = $derived(incident.canRecord);

	const acceptFields = acceptIncidentForm.fields;
	const retainFields = setIncidentRetainForm.fields;
	const noteFields = addIncidentNoteForm.fields;
	const resolveFields = resolveIncidentForm.fields;
	const reopenFields = reopenIncidentForm.fields;
</script>

<PageHeader
	width="3xl"
	subtitle={incidentCategoryLabels[incident.category]}
	title={incident.summary}
>
	<StatusBadge status={incident.status} label />
	{#if incident.status === 'reported'}
		<Action
			action={acceptIncidentForm}
			label={m.staff_incidents_id_accept()}
			modalTitle={m.staff_incidents_id_accept_report()}
			confirm={m.staff_incidents_id_joins_log_as_open_incident()}
			successToast={m.staff_incidents_id_accepted()}
			variant="primary"
			size="sm"
		>
			{#snippet form()}
				<input {...acceptFields.incidentId.as('hidden', id)} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="grid gap-6">
		<InfoCard title={m.staff_report()}>
			<DefinitionList>
				<Fact label={m.staff_when()}>{formatDateTime(incident.occurredAt)}</Fact>
				{#if incident.location}
					<Fact label={m.staff_where()}>{incident.location}</Fact>
				{/if}
				<Fact label={m.staff_what_happened()} wrap>{incident.description}</Fact>
				{#if incident.involvedUserId}
					<Fact label={m.staff_member_involved()}>
						<a class="link" href={resolve(`/staff/members/${incident.involvedUserId}`)}>
							{incident.involvedName ?? m.staff_member()}
						</a>
					</Fact>
				{/if}
				{#if incident.eventId}
					<Fact label={m.staff_show()}>
						<a class="link" href={resolve(`/staff/events/${incident.eventId}`)}>
							{incident.eventTitle ?? m.staff_event()}
						</a>
					</Fact>
				{/if}
				<Fact label={m.staff_recorded_by()}>
					{incident.reportedByName}, {formatDateTime(incident.createdAt)}
				</Fact>
			</DefinitionList>
		</InfoCard>

		<InfoCard title={m.staff_notes()} state={incident.notes.length}>
			{#snippet action()}
				{#if canRecord}
					<Action
						action={addIncidentNoteForm}
						label={m.staff_incidents_id_add_note()}
						modalTitle={m.staff_incidents_id_add_note_2()}
						successToast={m.staff_incidents_id_note_added()}
						size="sm"
					>
						{#snippet form()}
							<input {...noteFields.incidentId.as('hidden', id)} />
							<Field field={noteFields.body} type="textarea" label={m.staff_incidents_id_note()} />
						{/snippet}
					</Action>
				{/if}
			{/snippet}
			{#if incident.notes.length === 0}
				<p class="text-muted">{m.staff_incidents_id_no_follow_ups_yet()}</p>
			{:else}
				<ol class="space-y-3">
					{#each incident.notes as n (n.id)}
						<li>
							<div class="text-subtle">{n.authorName} · {formatDateTime(n.createdAt)}</div>
							<p class="whitespace-pre-line">{n.body}</p>
						</li>
					{/each}
				</ol>
			{/if}
		</InfoCard>

		<InfoCard title={m.staff_resolution()} class="bg-base-200 shadow-none">
			{#if incident.status !== 'resolved' && !canRecord}
				<p class="text-muted">{m.staff_incidents_id_not_resolved_yet()}</p>
			{:else if incident.status !== 'resolved'}
				<Action
					action={resolveIncidentForm}
					label={m.staff_resolve()}
					modalTitle={m.staff_incidents_id_resolve_incident()}
					successToast={m.staff_incidents_id_incident_resolved()}
					variant="primary"
					size="sm"
				>
					{#snippet form()}
						<input {...resolveFields.incidentId.as('hidden', id)} />
						<Field
							field={resolveFields.resolution}
							type="textarea"
							label={m.staff_incidents_id_how_was_resolved()}
						/>
					{/snippet}
				</Action>
			{:else}
				<DefinitionList>
					<Fact label={m.staff_resolution()} wrap>{incident.resolution}</Fact>
					{#if incident.resolvedAt}
						<Fact label={m.staff_resolved()}>{formatDateTime(incident.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
				{#if canRecord}
					<div class="mt-3">
						<Action
							action={reopenIncidentForm}
							label={m.staff_reopen()}
							modalTitle={m.staff_incidents_id_reopen_incident()}
							confirm={m.staff_incidents_id_current_resolution_kept_its_history()}
							successToast={m.staff_incidents_id_incident_reopened()}
							size="sm"
						>
							{#snippet form()}
								<input {...reopenFields.incidentId.as('hidden', id)} />
							{/snippet}
						</Action>
					</div>
				{/if}
			{/if}
		</InfoCard>

		<InfoCard title={m.staff_incidents_id_retention()} class="bg-base-200 shadow-none">
			<p class="text-muted text-wrap">
				{incident.retain
					? m.staff_incidents_id_marked_retain_kept_past_seven()
					: m.staff_incidents_id_deleted_seven_years_after_happened()}
			</p>
			<div class="mt-3">
				<Action
					action={setIncidentRetainForm}
					label={incident.retain
						? m.staff_incidents_id_release_hold()
						: m.staff_incidents_id_mark_retain()}
					modalTitle={incident.retain
						? m.staff_incidents_id_release_retention_hold()
						: m.staff_incidents_id_keep_record()}
					successToast={incident.retain
						? m.staff_incidents_id_hold_released()
						: m.staff_incidents_id_marked_retain()}
					size="sm"
				>
					{#snippet form()}
						<input {...retainFields.incidentId.as('hidden', id)} />
						<input {...retainFields.retain.as('hidden', incident.retain ? 'false' : 'true')} />
						<Field
							field={retainFields.reason}
							type="text"
							label={m.staff_why()}
							description={m.staff_incidents_id_description()}
						/>
					{/snippet}
				</Action>
			</div>
		</InfoCard>

		<ActivityFeedCard
			title={m.staff_history()}
			query={(limit) => getIncidentHistory(limit ? { id, limit } : { id })}
			toRow={feedItemRow}
			empty={{ title: m.staff_no_recorded_changes() }}
		/>
	</div>
</PageContent>
