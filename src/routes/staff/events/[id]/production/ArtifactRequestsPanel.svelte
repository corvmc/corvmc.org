<!--
	What the bill still owes us, and the ask that starts the wait.

	Arrival is derived from the artifact itself, so nothing here is ticked off by
	hand and a rider filled in unprompted already reads as in. Asking the same act
	for the same thing again is a reminder, not a second row.
-->
<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { requestableArtifacts, requestableArtifactLabels } from '$lib/config';
	import {
		askForArtifact,
		dropArtifactRequest,
		usePosterArt,
		usePosterArtWithFooter
	} from '$lib/remote/productions.remote';
	import { searchAskableListings } from '$lib/remote/external-acts.remote';
	import type { OutstandingRequest } from '$lib/types/artifact-request';

	// The picker writes a plain hidden input; the Action's form is not a `<Form>`.
	const artistField = {
		as: (_type: 'hidden', value: string) => ({ type: 'hidden', name: 'entryId', value })
	};

	let {
		eventId,
		eventTitle,
		requests,
		acts,
		onchange
	}: {
		eventId: string;
		eventTitle: string;
		requests: OutstandingRequest[];
		acts: { entryId: string; name: string }[];
		onchange: () => void;
	} = $props();

	const outstanding = $derived(requests.filter((r) => !r.fulfilled));
	const overdue = $derived(outstanding.filter((r) => r.overdue).length);
</script>

<InfoCard title="Asked for">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<div class="flex items-center gap-1">
				{#if overdue > 0}
					<Badge variant="error">{overdue} overdue</Badge>
				{:else if outstanding.length > 0}
					<Badge variant="warning">{outstanding.length} outstanding</Badge>
				{/if}
				{#if acts.length > 0}
					<Action
						action={askForArtifact}
						label="Ask an act"
						variant="ghost"
						size="sm"
						modalTitle="Ask for something for {eventTitle}"
						submitLabel="Ask"
						successToast="Asked"
						onsuccess={onchange}
					>
						{#snippet form()}
							<input type="hidden" name="eventId" value={eventId} />
							<FormField
								name="entryId"
								label="Act"
								type="select"
								options={acts.map((a) => ({ value: a.entryId, label: a.name }))}
							/>
							<FormField
								name="artifact"
								label="What"
								type="select"
								options={requestableArtifacts.map((a) => ({
									value: a,
									label: requestableArtifactLabels[a]
								}))}
							/>
							<FormField
								name="dueDate"
								label="Due"
								type="date"
								description="Optional. A request with no date is open-ended and never reads as overdue."
							/>
						{/snippet}
					</Action>
				{/if}
				<!-- An artist is never on the bill, so this searches every listing. -->
				<Action
					action={askForArtifact}
					label="Commission poster art"
					variant="ghost"
					size="sm"
					modalTitle="Commission poster art for {eventTitle}"
					submitLabel="Ask"
					successToast="Asked"
					onsuccess={onchange}
				>
					{#snippet form()}
						<input type="hidden" name="eventId" value={eventId} />
						<input type="hidden" name="artifact" value="poster_art" />
						<MemberPicker
							field={artistField}
							label="Artist"
							placeholder="Search listings by name..."
							search={(q) => searchAskableListings(q)}
						/>
						<FormField
							name="dueDate"
							label="Due"
							type="date"
							description="When the art has to be in. Past it, the request reads overdue and the template flyer is the fallback."
						/>
						<p class="text-subtle text-sm">
							The artist uploads on their contact-sheet page. Send them its link from the listing if
							they do not have it.
						</p>
					{/snippet}
				</Action>
			</div>
		</div>
	{/snippet}

	{#if requests.length === 0}
		<EmptyState
			title="Nothing asked for"
			description="Nobody has been asked for a rider, a press kit or poster art yet."
		/>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each requests as req (req.id)}
				<li class="flex flex-wrap items-center gap-2 py-2">
					<span class="font-medium">{req.actName ?? 'Unknown act'}</span>
					<span class="text-sm">{requestableArtifactLabels[req.artifact]}</span>
					{#if req.fulfilled}
						<Badge variant="success">In</Badge>
					{:else if req.overdue}
						<Badge variant="error">Overdue</Badge>
					{:else}
						<Badge variant="warning">Waiting</Badge>
					{/if}
					<span class="text-subtle text-sm whitespace-nowrap">
						{#if req.dueAt}
							due {formatDateShort(req.dueAt)}
						{:else}
							no deadline
						{/if}
					</span>
					<div class="ml-auto flex items-center gap-1">
						{#if req.deliveredUrl}
							<a href={req.deliveredUrl} target="_blank" rel="external noreferrer">
								<img
									src={req.deliveredUrl}
									alt="Poster art from {req.actName ?? 'the artist'}"
									class="h-12 w-auto rounded"
								/>
							</a>
							<Action
								action={usePosterArt}
								label="Use as poster"
								variant="ghost"
								size="sm"
								modalTitle="Make this the poster?"
								submitLabel="Use as poster"
								successToast="Poster updated"
								onsuccess={onchange}
							>
								{#snippet form()}
									<input type="hidden" name="requestId" value={req.id} />
									<input type="hidden" name="eventId" value={eventId} />
									<p class="text-sm">
										The art from {req.actName ?? 'the artist'} replaces the event's current poster.
									</p>
								{/snippet}
							</Action>
							<Action
								action={usePosterArtWithFooter}
								label="Use with a details footer"
								variant="ghost"
								size="sm"
								modalTitle="Add the show details under this art?"
								submitLabel="Make the poster"
								successToast="Poster updated"
								onsuccess={onchange}
							>
								{#snippet form()}
									<input type="hidden" name="requestId" value={req.id} />
									<input type="hidden" name="eventId" value={eventId} />
									<p class="text-sm">
										The art sits above a footer with the date, doors, venue and price, and the
										result replaces the current poster. It is a snapshot: after editing the event,
										run this again.
									</p>
								{/snippet}
							</Action>
						{/if}
						<Action
							action={dropArtifactRequest}
							label="Cancel"
							variant="ghost"
							size="sm"
							modalTitle="Stop waiting on this?"
							submitLabel="Cancel request"
							successToast="Request cancelled"
							onsuccess={onchange}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={req.id} />
								<input type="hidden" name="eventId" value={eventId} />
								<p class="text-sm">
									{requestableArtifactLabels[req.artifact]} from {req.actName ?? 'this act'} stops counting
									as outstanding. Asking again re-opens it.
								</p>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
