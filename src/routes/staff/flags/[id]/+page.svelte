<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { getFlagDetail, resolveFlag } from '#lib/remote/flags.remote.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateTime } from '#lib/utils/format.js';
	import { entityLabels } from '#lib/terms.js';
	import ThreadTimeline from '#lib/components/inbox/ThreadTimeline.svelte';
	import AppealCard from './AppealCard.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let id = $derived(params.id);
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
	// No default. "Resolved — action taken" used to be pre-selected, so a
	// moderator who pressed the primary button without reading recorded
	// enforcement against a member rather than the no-op — and the consequence
	// copy below only renders once `resolved` is chosen, so it was invisible
	// exactly when it mattered (#981).
	let resolution = $state<'' | 'resolved' | 'dismissed'>('');

	// The button says what it will do, because it is the only thing read.
	const resolveLabel = $derived(
		resolution === 'resolved'
			? m.staff_flags_id_resolve_action_taken_label()
			: resolution === 'dismissed'
				? m.staff_flags_id_dismiss_no_action_label()
				: m.staff_flags_id_choose_outcome_first_label()
	);
	let notes = $state('');
</script>

<PageHeader width="3xl" subtitle={m.staff_flags_id_subtitle_body()} title={flag.entityLabel}>
	<StatusBadge status={flag.status} label />
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.staff_report_title()}>
			<DefinitionList>
				<Fact label={m.staff_type_label()}>{entityLabels[flag.target.type].one}</Fact>

				<Fact label={m.staff_content_label()}>
					<EntityChip ref={flag.target} />
				</Fact>

				<Fact label={m.staff_reason_label()}>{flag.reason}</Fact>

				{#if flag.description}
					<Fact label={m.staff_details_label()} wrap>{flag.description}</Fact>
				{/if}

				<Fact
					label={flag.origin === 'staff_action'
						? m.staff_flags_id_staff_action_by_label()
						: m.staff_flags_id_reported_by_label()}
				>
					{#if flag.reportedByName}
						{flag.reportedByName} <span class="opacity-60">({flag.reportedByEmail})</span>
					{:else}
						{m.staff_flags_id_anonymous_visitor_text()}
					{/if}
				</Fact>

				<Fact label={m.staff_flags_id_reported_label()}>{formatDateTime(flag.createdAt)}</Fact>
			</DefinitionList>
		</InfoCard>

		{#if flag.threadContext}
			<InfoCard title={m.staff_flags_id_conversation_title()}>
				<p class="mb-3 text-muted">
					{m.staff_flags_id_private_conversation_between_two_members_text()}
				</p>
				<!-- `DefinitionList`, like the two cards further up this same page. -->
				<DefinitionList>
					<Fact label={m.staff_flags_id_between_label()} class="flex flex-wrap gap-2">
						{#each flag.threadContext.participants as p (p.userId)}
							<a class="link" href={resolve(`staff/members/${p.userId}`)}>
								{p.name}{#if p.isReporter}<span class="ml-1 opacity-60"
										>{m.staff_flags_id_reported_2_text()}</span
									>{/if}
							</a>
						{/each}
					</Fact>

					<Fact label={m.staff_flags_id_messages_label()}>{flag.threadContext.messageCount}</Fact>
					<Fact label={m.staff_flags_id_started_label()}
						>{formatDateTime(flag.threadContext.createdAt)}</Fact
					>
				</DefinitionList>

				<div class="mt-4">
					<ThreadTimeline messages={flag.threadContext.messages} viewerUserId={reporterId} />
				</div>
			</InfoCard>
		{/if}

		{#if flag.eventContext}
			<InfoCard title={m.staff_flags_id_event_details_title()}>
				<DefinitionList>
					<Fact label={m.staff_title_label()} class="font-medium">{flag.eventContext.title}</Fact>

					<Fact label={m.staff_date_label()}>{formatDateTime(flag.eventContext.startsAt)}</Fact>

					{#if flag.eventContext.location}
						<Fact label={m.staff_venue_label()}>{flag.eventContext.location}</Fact>
					{/if}

					<Fact label={m.staff_by_2_label()}>
						{#if flag.eventBandRef}
							<EntityChip ref={flag.eventBandRef} />
						{:else}
							{m.staff_flags_id_cmc_text()}
						{/if}
					</Fact>

					<Fact label={m.staff_status_label()}
						><StatusBadge status={flag.eventContext.status} label /></Fact
					>
				</DefinitionList>
				<div class="mt-3">
					<Button href={entityHref} variant="default" size="sm" outline
						>{m.staff_flags_id_view_public_listing_label()}</Button
					>
				</div>
			</InfoCard>
		{/if}

		<InfoCard title={m.staff_resolution_title()} class="bg-base-200 shadow-none">
			{#if flag.status === 'pending'}
				<p class="mb-3 text-muted">
					{m.staff_flags_id_review_reported_content_then_mark_text()}
				</p>
				<div class="flex gap-2">
					<Button href={entityHref} variant="default" size="sm" outline
						>{m.staff_flags_id_view_content_label()}</Button
					>
					<Action
						action={resolveFlag}
						data-testid="resolve-flag"
						label={m.staff_flags_id_resolve_dismiss_label()}
						modalTitle={m.staff_flags_id_modal_title()}
						submitLabel={resolveLabel}
						successToast={m.staff_flags_id_success_toast()}
						variant="primary"
						size="sm"
						onsuccess={() => void getFlagDetail(id).refresh()}
					>
						{#snippet form()}
							<input {...fields.flagId.as('hidden', id)} />
							<div class="space-y-3">
								<label class="fieldset w-full">
									<span class="fieldset-legend">{m.staff_resolution_label()}</span>
									<Select
										class="w-full"
										{...fields.resolution.as('select')}
										bind:value={resolution}
									>
										<option value="" disabled>{m.staff_flags_id_choose_outcome_label()}</option>
										<option value="resolved"
											>{m.staff_flags_id_resolved_action_taken_label()}</option
										>
										<option value="dismissed"
											>{m.staff_flags_id_dismissed_no_action_needed_label()}</option
										>
									</Select>
								</label>
								<label class="fieldset w-full">
									<span class="fieldset-legend">{m.staff_flags_id_notes_optional_label()}</span>
									<textarea
										class="textarea w-full"
										rows="3"
										{...fields.notes.as('text')}
										bind:value={notes}></textarea>
								</label>
								{#if flag.entityType === 'event' && flag.eventContext?.source === 'community' && resolution === 'resolved'}
									<!-- Say this out loud. Resolving a community-listing flag is
									     the only thing in the app that changes a member's
									     standing, and a staffer shouldn't discover that
									     afterwards. -->
									<p class="text-muted text-wrap">
										{m.staff_flags_id_resolving_also_means_member_who_text()}
									</p>
								{/if}
								{#if flag.entityType === 'suggestion'}
									<!-- Same reason as the community-listing note above: this is the
									     other place resolving a report changes a member's standing,
									     and it also decides whether their post ever comes back. -->
									<p class="text-muted text-wrap">
										{#if resolution === 'resolved'}
											{m.staff_flags_id_resolving_keeps_suggestion_off_board_text()}
										{:else}
											{m.staff_flags_id_dismissing_puts_suggestion_straight_back_text()}
										{/if}
									</p>
								{/if}
								{#if canUnpublish && resolution === 'resolved'}
									<label class="label cursor-pointer justify-start gap-2">
										<input class="checkbox checkbox-sm" {...fields.unpublishEvent.as('checkbox')} />
										<span class="fieldset-legend text-wrap">
											{#if flag.eventContext?.source === 'community'}
												{m.staff_flags_id_also_unpublish_listing_removes_from_label()}
											{:else}
												{m.staff_flags_id_also_unpublish_event_removes_from_label()}
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
					<Fact label={m.staff_flags_id_outcome_label()}
						><StatusBadge status={flag.status} label /></Fact
					>

					{#if flag.resolutionNotes}
						<Fact label={m.staff_notes_label()} wrap>{flag.resolutionNotes}</Fact>
					{/if}

					{#if flag.resolvedAt}
						<Fact label={m.staff_resolved_label()}>{formatDateTime(flag.resolvedAt)}</Fact>
					{/if}
				</DefinitionList>
				<div class="mt-3">
					<Button href={entityHref} variant="default" size="sm" outline
						>{m.staff_flags_id_view_content_label()}</Button
					>
				</div>
			{/if}
		</InfoCard>

		{#if flag.appeal}
			<AppealCard flagId={id} appeal={flag.appeal} />
		{/if}
	</div>
</PageContent>
