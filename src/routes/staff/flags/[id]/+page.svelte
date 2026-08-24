<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getFlagDetail, resolveFlag } from '$lib/remote/flags.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { EntityChip } from '$lib/components/shared/entity';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { entityLabels } from '$lib/config';
	import ThreadTimeline from '$lib/components/inbox/ThreadTimeline.svelte';

	let id = $derived(page.params.id!);
	let flag = $derived(await getFlagDetail(id));

	// `flag.entityHref` is the server's own answer, which this page used to
	// recompute with a five-deep ternary beside it — two copies of one route
	// table, already disagreeing about where a flagged event lives. The buttons
	// below take it as-is; the chip derives its own from `flag.target`.
	let entityHref = $derived(flag.entityHref);

	// The timeline is drawn from the reporter's point of view: their messages sit
	// on the right. Without this it falls back to inbound/outbound — the org's
	// point of view — and neither member is the org, so every bubble would land
	// on the same side.
	let reporterId = $derived(flag.reportedByUserId);

	// Staff can pull a still-published flagged event off the public guide while
	// resolving; the band's admins are notified with the resolution note.
	let canUnpublish = $derived(
		flag.entityType === 'event' && flag.eventContext?.status === 'published'
	);

	const { fields } = resolveFlag;
	let resolution = $state<'resolved' | 'dismissed'>('resolved');
	let notes = $state('');
</script>

<PageHeader subtitle="Content Flag" title={flag.entityLabel} backHref="/staff/flags">
	<StatusBadge status={flag.status} label />
</PageHeader>
<PageContent width="3xl">
	<div class="grid gap-6 lg:grid-cols-2 mb-6">
		<InfoCard title="Report">
			<DefinitionList>
				<Fact label="Type">{entityLabels[flag.target.type].one}</Fact>

				<Fact label="Content">
					<EntityChip ref={flag.target} />
				</Fact>

				<Fact label="Reason">{flag.reason}</Fact>

				{#if flag.description}
					<Fact label="Details" wrap>{flag.description}</Fact>
				{/if}

				<Fact label="Reported by">
					{#if flag.reportedByName}
						{flag.reportedByName} <span class="opacity-60">({flag.reportedByEmail})</span>
					{:else}
						Anonymous visitor
					{/if}
				</Fact>

				<Fact label="Reported">{formatDateTime(flag.createdAt)}</Fact>
			</DefinitionList>
		</InfoCard>

		{#if flag.threadContext}
			<InfoCard title="Conversation">
				<p class="mb-3 text-muted">
					A private conversation between two members. It is not in the inbox and has no page of its
					own — this report is what makes it readable.
				</p>
				<dl class="grid gap-x-4 gap-y-2 text-sm" style="grid-template-columns: auto 1fr;">
					<dt class="opacity-60">Between</dt>
					<dd class="flex flex-wrap gap-2">
						{#each flag.threadContext.participants as p (p.userId)}
							<a class="link" href={resolve(`/staff/users/${p.userId}`)}>
								{p.name}{#if p.isReporter}<span class="ml-1 opacity-60">(reported it)</span>{/if}
							</a>
						{/each}
					</dd>

					<dt class="opacity-60">Messages</dt>
					<dd>{flag.threadContext.messageCount}</dd>

					<dt class="opacity-60">Started</dt>
					<dd>{formatDateTime(flag.threadContext.createdAt)}</dd>
				</dl>

				<div class="mt-4">
					<ThreadTimeline messages={flag.threadContext.messages} viewerUserId={reporterId} />
				</div>
			</InfoCard>
		{/if}

		{#if flag.eventContext}
			<InfoCard title="Event details">
				<DefinitionList>
					<Fact label="Title" class="font-medium">{flag.eventContext.title}</Fact>

					<Fact label="Date">{formatDateTime(flag.eventContext.startsAt)}</Fact>

					{#if flag.eventContext.location}
						<Fact label="Venue">{flag.eventContext.location}</Fact>
					{/if}

					<Fact label="By">
						{#if flag.eventBandRef}
							<EntityChip ref={flag.eventBandRef} />
						{:else}
							CMC
						{/if}
					</Fact>

					<Fact label="Status"><StatusBadge status={flag.eventContext.status} label /></Fact>
				</DefinitionList>
				<div class="mt-3">
					<Button href={entityHref} variant="default" size="sm" outline>View public listing</Button>
				</div>
			</InfoCard>
		{/if}

		<InfoCard title="Resolution" class="bg-base-200 shadow-none">
			{#if flag.status === 'pending'}
				<p class="text-muted mb-3">
					Review the reported content, then mark this flag resolved (action taken) or dismissed (no
					action needed).
				</p>
				<div class="flex gap-2">
					<Button href={entityHref} variant="default" size="sm" outline>View content</Button>
					<Action
						action={resolveFlag}
						label="Resolve / Dismiss"
						modalTitle="Resolve flag"
						submitLabel="Save"
						successToast="Flag updated"
						variant="primary"
						size="sm"
						onsuccess={() => void getFlagDetail(id).refresh()}
					>
						{#snippet form()}
							<input {...fields.flagId.as('hidden', id)} />
							<div class="space-y-3">
								<label class="form-control w-full">
									<div class="label"><span class="label-text">Resolution</span></div>
									<Select
										class="w-full"
										{...fields.resolution.as('select')}
										bind:value={resolution}
									>
										<option value="resolved">Resolved — action taken</option>
										<option value="dismissed">Dismissed — no action needed</option>
									</Select>
								</label>
								<label class="form-control w-full">
									<div class="label"><span class="label-text">Notes (optional)</span></div>
									<textarea
										class="textarea w-full"
										rows="3"
										{...fields.notes.as('text')}
										bind:value={notes}
									></textarea>
								</label>
								{#if flag.entityType === 'event' && flag.eventContext?.source === 'community' && resolution === 'resolved'}
									<!-- Say this out loud. Resolving a community-listing flag is
									     the only thing in the app that changes a member's
									     standing, and a staffer shouldn't discover that
									     afterwards. -->
									<p class="text-muted text-wrap">
										Resolving this also means the member who posted it has their future listings
										checked by staff before they publish. Dismissing changes nothing.
									</p>
								{/if}
								{#if flag.entityType === 'suggestion'}
									<!-- Same reason as the community-listing note above: this is the
									     other place resolving a report changes a member's standing,
									     and it also decides whether their post ever comes back. -->
									<p class="text-muted text-wrap">
										{#if resolution === 'resolved'}
											Resolving keeps this suggestion off the board and means the member who posted
											it has their future suggestions checked by staff first.
										{:else}
											Dismissing puts the suggestion straight back on the board. The member's
											standing is unchanged.
										{/if}
									</p>
								{/if}
								{#if canUnpublish && resolution === 'resolved'}
									<label class="label cursor-pointer justify-start gap-2">
										<input class="checkbox checkbox-sm" {...fields.unpublishEvent.as('checkbox')} />
										<span class="label-text text-wrap">
											{#if flag.eventContext?.source === 'community'}
												Also unpublish this listing (removes it from the public gig guide and
												deletes its poster; the member is notified with your note)
											{:else}
												Also unpublish this event (removes it from the public gig guide; the band's
												admins are notified with your note)
											{/if}
										</span>
									</label>
								{/if}
							</div>
						{/snippet}
					</Action>
				</div>
			{:else}
				<DefinitionList>
					<Fact label="Outcome"><StatusBadge status={flag.status} label /></Fact>

					{#if flag.resolutionNotes}
						<Fact label="Notes" wrap>{flag.resolutionNotes}</Fact>
					{/if}

					{#if flag.resolvedAt}
						<Fact label="Resolved">{formatDateTime(flag.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
				<div class="mt-3">
					<Button href={entityHref} variant="default" size="sm" outline>View content</Button>
				</div>
			{/if}
		</InfoCard>
	</div>
</PageContent>
