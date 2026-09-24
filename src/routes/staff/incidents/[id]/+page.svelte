<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { formatDateTime } from '$lib/utils/format';
	import { incidentCategoryLabels } from '$lib/config';
	import {
		getIncidentDetail,
		acceptIncidentForm,
		addIncidentNoteForm,
		resolveIncidentForm,
		reopenIncidentForm
	} from '$lib/remote/incidents.remote';

	let id = $derived(page.params.id!);
	let incident = $derived(await getIncidentDetail(id));
	const canRecord = $derived(incident.canRecord);

	const acceptFields = acceptIncidentForm.fields;
	const noteFields = addIncidentNoteForm.fields;
	const resolveFields = resolveIncidentForm.fields;
	const reopenFields = reopenIncidentForm.fields;
</script>

<PageHeader
	width="3xl"
	subtitle={incidentCategoryLabels[incident.category]}
	title={incident.summary}
	backHref="/staff/incidents"
>
	<StatusBadge status={incident.status} label />
	{#if incident.status === 'reported'}
		<Action
			action={acceptIncidentForm}
			label="Accept"
			modalTitle="Accept this report"
			confirm="It joins the log as an open incident. You can resolve it straight away instead."
			successToast="Accepted"
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
		<InfoCard title="Report">
			<DefinitionList>
				<Fact label="When">{formatDateTime(incident.occurredAt)}</Fact>
				{#if incident.location}
					<Fact label="Where">{incident.location}</Fact>
				{/if}
				<Fact label="What happened" wrap>{incident.description}</Fact>
				{#if incident.involvedUserId}
					<Fact label="Member involved">
						<a class="link" href={resolve(`/staff/users/${incident.involvedUserId}`)}>
							{incident.involvedName ?? 'Member'}
						</a>
					</Fact>
				{/if}
				{#if incident.eventId}
					<Fact label="Show">
						<a class="link" href={resolve(`/staff/events/${incident.eventId}`)}>
							{incident.eventTitle ?? 'Event'}
						</a>
					</Fact>
				{/if}
				<Fact label="Recorded by">
					{incident.reportedByName}, {formatDateTime(incident.createdAt)}
				</Fact>
			</DefinitionList>
		</InfoCard>

		<InfoCard title="Notes" state={incident.notes.length}>
			{#snippet action()}
				{#if canRecord}
					<Action
						action={addIncidentNoteForm}
						label="Add note"
						modalTitle="Add a note"
						successToast="Note added"
						size="sm"
					>
						{#snippet form()}
							<input {...noteFields.incidentId.as('hidden', id)} />
							<Field field={noteFields.body} type="textarea" label="Note" />
						{/snippet}
					</Action>
				{/if}
			{/snippet}
			{#if incident.notes.length === 0}
				<p class="text-muted">No follow-ups yet.</p>
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

		<InfoCard title="Resolution" class="bg-base-200 shadow-none">
			{#if incident.status !== 'resolved' && !canRecord}
				<p class="text-muted">Not resolved yet.</p>
			{:else if incident.status !== 'resolved'}
				<Action
					action={resolveIncidentForm}
					label="Resolve"
					modalTitle="Resolve this incident"
					successToast="Incident resolved"
					variant="primary"
					size="sm"
				>
					{#snippet form()}
						<input {...resolveFields.incidentId.as('hidden', id)} />
						<Field field={resolveFields.resolution} type="textarea" label="How it was resolved" />
					{/snippet}
				</Action>
			{:else}
				<DefinitionList>
					<Fact label="Resolution" wrap>{incident.resolution}</Fact>
					{#if incident.resolvedAt}
						<Fact label="Resolved">{formatDateTime(incident.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
				{#if canRecord}
					<div class="mt-3">
						<Action
							action={reopenIncidentForm}
							label="Reopen"
							modalTitle="Reopen this incident"
							confirm="The current resolution is kept as a note."
							successToast="Incident reopened"
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
	</div>
</PageContent>
