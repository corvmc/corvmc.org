<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { formatDateTime } from '#lib/utils/format.js';
	import {
		suggestionCategoryLabels,
		suggestionStatuses,
		suggestionStatusLabels,
		surfaces
	} from '#lib/config.js';
	import {
		getStaffSuggestionDetailPage,
		respondToSuggestion,
		reviewSuggestion,
		setSuggestionVisibility,
		mergeSuggestion,
		reviewSuggestionEdit
	} from '#lib/remote/suggestions.remote.js';
	import MergeCandidateOptions from './MergeCandidateOptions.svelte';
	import { startProjectFromSuggestionForm } from '#lib/remote/projects.remote.js';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import BallotLine from '#lib/components/ballot/BallotLine.svelte';
	import CreateBallotAction from '#lib/components/ballot/CreateBallotAction.svelte';

	let id = $derived(page.params.id!);

	// The merge candidates used to live here, declared above the awaits so they would not be
	// compiled as "blocked" — the JAVASCRIPT-SVELTEKIT-25 shape. They load in
	// MergeCandidateOptions now, where there is no await to be blocked by.
	// Above the awaited query, like the fields below it: a declaration after a
	// top-level await is async-gated, and `fields.X.as()` compiled into an async
	// derived is the shape `src/async-effect-shape.spec.ts` pins against.
	const projectFields = startProjectFromSuggestionForm.fields;

	const data = $derived(await getStaffSuggestionDetailPage(id));
	const s = $derived(data.suggestion);
	const pendingEdit = $derived(data.pendingEdit);
	const project = $derived(data.project);
	const fulfilledBy = $derived(data.fulfilledBy);
	const ballots = $derived(data.ballots);
	const ballotCommittees = $derived(data.ballotCommittees);
	const liveBallot = $derived(ballots.some((b) => b.status === 'open' || b.status === 'closed'));
	// Only gear can be answered by something arriving on a shelf.
	const isGear = $derived(s.category === 'gear_equipment');
	const committeeOptions = $derived(data.committees.map((c) => ({ value: c.id, label: c.name })));

	const isMerged = $derived(!!s.mergedIntoId);

	function refresh() {
		void getStaffSuggestionDetailPage(id).refresh();
	}
</script>

<PageHeader width="3xl" title={s.title} subtitle={m.staff_suggestion()}>
	<StatusBadge status={isMerged ? 'merged' : s.status} label />
</PageHeader>

<PageContent width="3xl">
	{#if isMerged}
		<Alert type="info" href={resolve(`staff/suggestions/${s.mergedIntoId}`)}>
			<ParaglideMessage
				message={m.staff_suggestions_id_merged_into_its_votes_moved}
				inputs={{
					mergedIntoTitle: s.mergedIntoTitle ?? m.staff_suggestions_id_another_suggestion()
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{:else if s.visibility === 'under_review'}
		<!-- One report, one place to decide. Resolving here as well as in the flag
		     queue would let two staff reach opposite conclusions on one report. -->
		<Alert type="warning" href={resolve('staff/flags')}>
			{m.staff_suggestions_id_member_reported_so_came_off()}
		</Alert>
	{:else if s.visibility === 'hidden'}
		<Alert type="error">
			{s.visibilityNote
				? m.staff_suggestions_id_hidden_note({ note: s.visibilityNote })
				: m.staff_suggestions_id_hidden()}
		</Alert>
	{/if}

	<!-- The thing itself, or the way to record it arriving. A gear request sat
	     at Planned after the amp was on the shelf, because the acquisition and
	     the suggestion had no relationship at all (#603). -->
	{#if fulfilledBy}
		<Alert type="success" href={resolve(`staff/inventory/acquisitions/${fulfilledBy.id}`)}>
			{fulfilledBy.sourceName
				? m.staff_suggestions_id_arrived_from({
						date: formatDateTime(fulfilledBy.occurredAt),
						source: fulfilledBy.sourceName
					})
				: m.staff_suggestions_id_arrived({ date: formatDateTime(fulfilledBy.occurredAt) })}
		</Alert>
	{:else if isGear && !isMerged && (s.status === 'planned' || s.status === 'in_progress')}
		<Alert type="info">
			{m.staff_suggestions_id_got_record_arrival_closes_itself()}
			<!-- The action, not the alert's own `href`: that prop is a
			     `ResolvedPathname` and a query string is not one. -->
			{#snippet action()}
				<Button
					href="{resolve('staff/inventory/intake')}?suggestion={s.id}"
					variant="ghost"
					size="sm"
				>
					{m.staff_suggestions_id_record_arrival()}
				</Button>
			{/snippet}
		</Alert>
	{/if}

	<!--
		The work this became, or the button that starts it.

		This is the half of the board that was missing: a suggestion reached `done`
		because a staffer said so, with no link to whatever actually did it. A
		project here is that link, and the votes above are its mandate.
	-->
	{#if project}
		<Alert type="success" href={resolve(`staff/projects/${project.id}`)}>
			<ParaglideMessage
				message={m.staff_suggestions_id_answered_by_its_status_drives}
				inputs={{ name: project.name }}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	{#if ballots.length > 0}
		<InfoCard title={ballots.length === 1 ? m.staff_suggestions_id_ballot() : m.staff_ballots()}>
			<ul class="space-y-2">
				{#each ballots as b (b.id)}
					<li><BallotLine ballot={b} href={resolve(`staff/ballots/${b.id}`)} /></li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	{#if !project && !isMerged && s.status !== 'declined'}
		<InfoCard title={m.staff_suggestions_id_decide()} class="bg-base-200 shadow-none">
			<p class="mb-3 text-muted">
				{m.staff_suggestions_id_commit_idea_directly_project_groups()}
				{#if surfaces.ballots}
					{m.staff_suggestions_id_if_needs_vote_first_put()}
				{/if}
			</p>
			{#if ballotCommittees && !liveBallot}
				<div class="mb-3 flex flex-wrap gap-2">
					<CreateBallotAction
						kind="member"
						panel="staff"
						decides={{ suggestionId: s.id, title: s.title }}
					/>
					{#if ballotCommittees.length > 0}
						<CreateBallotAction
							kind="group"
							panel="staff"
							committees={ballotCommittees}
							decides={{ suggestionId: s.id, title: s.title }}
						/>
					{/if}
				</div>
			{/if}
			<Action
				action={startProjectFromSuggestionForm}
				label={m.staff_suggestions_id_start_project()}
				modalTitle={m.staff_suggestions_id_start_project()}
				submitLabel={m.staff_start()}
				successToast={m.staff_suggestions_id_project_started()}
				variant="primary"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet form()}
					<input {...projectFields.suggestionId.as('hidden', id)} />
					<Field
						field={projectFields.name}
						type="text"
						label={m.staff_suggestions_id_project_name()}
						value={s.title}
					/>
					<Field
						field={projectFields.groupId}
						type="select"
						label={m.staff_suggestions_id_owning_committee()}
						options={committeeOptions}
						description={m.staff_suggestions_id_description()}
					/>
					<MoneyField field={projectFields.budgetCents} label={m.staff_suggestions_id_budget()} />
				{/snippet}
			</Action>
		</InfoCard>
	{/if}

	<InfoCard title={m.staff_suggestion()}>
		<DefinitionList>
			<Fact label={m.staff_category()}>
				<Badge size="sm" variant="outline">
					{suggestionCategoryLabels[s.category as keyof typeof suggestionCategoryLabels] ??
						s.category}
				</Badge>
			</Fact>

			<Fact label={m.staff_suggested_by()}><EntityChip ref={s.author} /></Fact>

			<Fact label={m.staff_posted()}>{formatDateTime(s.createdAt)}</Fact>
			<Fact label={m.staff_votes()} class="font-medium">{s.voteCount}</Fact>
		</DefinitionList>
		<p class="mt-3 whitespace-pre-wrap">{s.body}</p>
	</InfoCard>

	{#if s.visibility === 'pending_review'}
		<InfoCard title={m.staff_review()} class="bg-base-200 shadow-none">
			<p class="mb-3 text-muted">
				{m.staff_suggestions_id_member_posts_under_review_so()}
			</p>
			<Action
				action={reviewSuggestion}
				data-testid="review-suggestion"
				label={m.staff_suggestions_id_approve_reject()}
				modalTitle={m.staff_suggestions_id_review_suggestion()}
				submitLabel={m.staff_save()}
				successToast={m.staff_suggestions_id_reviewed()}
				variant="primary"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet form()}
					<input {...reviewSuggestion.fields.suggestionId.as('hidden', id)} />
					<div class="space-y-3">
						<label class="fieldset w-full">
							<span class="fieldset-legend">{m.staff_suggestions_id_decision()}</span>
							<Select class="w-full" {...reviewSuggestion.fields.decision.as('select')}>
								<option value="approve">{m.staff_suggestions_id_approve_put_board()}</option>
								<option value="reject">{m.staff_suggestions_id_reject_hide()}</option>
							</Select>
						</label>
						<label class="fieldset w-full">
							<span class="fieldset-legend">{m.staff_suggestions_id_note_member_optional()}</span>
							<textarea
								class="textarea w-full"
								rows="3"
								{...reviewSuggestion.fields.note.as('text')}></textarea>
						</label>
					</div>
				{/snippet}
			</Action>
		</InfoCard>
	{/if}

	{#if pendingEdit}
		<InfoCard title={m.staff_suggestions_id_proposed_edit()} class="bg-base-200 shadow-none">
			<p class="mb-3 text-muted">
				{m.staff_suggestions_id_wants_change_after_members_already({
					requestedByName: pendingEdit.requestedByName ?? m.staff_suggestions_id_author(),
					voteCount: s.voteCount
				})}
			</p>

			<!-- Before and after, side by side. Approving a change you can't see is
			     the failure this whole flow exists to prevent. -->
			<div class="grid gap-4 md:grid-cols-2">
				<div>
					<h3 class="mb-1 text-muted font-medium">{m.staff_suggestions_id_what_members_voted()}</h3>
					<div class="rounded border border-base-300 p-3">
						<p class="font-medium">{pendingEdit.originalTitle}</p>
						<p class="mt-1 text-sm whitespace-pre-wrap">{pendingEdit.originalBody}</p>
						<p class="mt-2 text-subtle">
							{suggestionCategoryLabels[
								pendingEdit.originalCategory as keyof typeof suggestionCategoryLabels
							] ?? pendingEdit.originalCategory}
						</p>
					</div>
				</div>
				<div>
					<h3 class="mb-1 text-muted font-medium">{m.staff_suggestions_id_proposed()}</h3>
					<div class="rounded border border-primary/40 p-3">
						<p class="font-medium">{pendingEdit.proposedTitle}</p>
						<p class="mt-1 text-sm whitespace-pre-wrap">{pendingEdit.proposedBody}</p>
						<p class="mt-2 text-subtle">
							{suggestionCategoryLabels[
								pendingEdit.proposedCategory as keyof typeof suggestionCategoryLabels
							] ?? pendingEdit.proposedCategory}
						</p>
					</div>
				</div>
			</div>

			<div class="mt-3">
				<Action
					action={reviewSuggestionEdit}
					data-testid="review-suggestion-edit"
					label={m.staff_suggestions_id_approve_reject()}
					modalTitle={m.staff_suggestions_id_review_proposed_edit()}
					submitLabel={m.staff_save()}
					successToast={m.staff_suggestions_id_edit_reviewed()}
					variant="primary"
					size="sm"
					onsuccess={refresh}
				>
					{#snippet form()}
						<input {...reviewSuggestionEdit.fields.suggestionId.as('hidden', id)} />
						<input {...reviewSuggestionEdit.fields.editId.as('hidden', pendingEdit?.id ?? '')} />
						<div class="space-y-3">
							<label class="fieldset w-full">
								<span class="fieldset-legend">{m.staff_suggestions_id_decision()}</span>
								<Select class="w-full" {...reviewSuggestionEdit.fields.decision.as('select')}>
									<option value="approve">{m.staff_suggestions_id_approve_replace_text()}</option>
									<option value="reject"
										>{m.staff_suggestions_id_reject_keep_what_members_voted()}</option
									>
								</Select>
							</label>
							<label class="fieldset w-full">
								<div class="label">
									<span class="fieldset-legend"
										>{m.staff_suggestions_id_note_member_optional()}</span
									>
								</div>
								<textarea
									class="textarea w-full"
									rows="3"
									{...reviewSuggestionEdit.fields.notes.as('text')}></textarea>
							</label>
						</div>
					{/snippet}
				</Action>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title={m.staff_suggestions_id_response()}>
		{#if s.responseBody}
			<p class="whitespace-pre-wrap">{s.responseBody}</p>
			<p class="mt-2 text-muted">
				{s.responderName ?? m.staff_staff()}{s.responseAt
					? ` · ${formatDateTime(s.responseAt)}`
					: ''}
			</p>
		{:else}
			<p class="text-muted">{m.staff_suggestions_id_nobody_has_written_back_yet()}</p>
		{/if}

		<div class="mt-3">
			<Action
				action={respondToSuggestion}
				label={s.responseBody
					? m.staff_suggestions_id_edit_response()
					: m.staff_suggestions_id_respond()}
				modalTitle={m.staff_suggestions_id_respond_suggestion()}
				submitLabel={m.staff_save()}
				successToast={m.staff_suggestions_id_response_saved()}
				variant="primary"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet form()}
					<input {...respondToSuggestion.fields.suggestionId.as('hidden', id)} />
					<div class="space-y-3">
						<label class="fieldset w-full">
							<span class="fieldset-legend">{m.staff_status()}</span>
							<Select class="w-full" {...respondToSuggestion.fields.status.as('select', s.status)}>
								{#each suggestionStatuses as st (st)}
									<option value={st}>{suggestionStatusLabels[st]}</option>
								{/each}
							</Select>
						</label>
						<label class="fieldset w-full">
							<span class="fieldset-legend">{m.staff_suggestions_id_public_reply()}</span>
							<textarea
								class="textarea w-full"
								rows="4"
								{...respondToSuggestion.fields.response.as('text', s.responseBody ?? '')}
							></textarea>
						</label>
						<!-- Status and reply are one form on purpose: split, the normal
						     workflow would send the member two notifications for one act. -->
						<p class="text-muted">
							{m.staff_suggestions_id_shown_suggestion_everyone_read_member()}
						</p>
					</div>
				{/snippet}
			</Action>
		</div>
	</InfoCard>

	{#if !isMerged}
		<div class="grid gap-6 lg:grid-cols-2">
			<InfoCard title={m.staff_suggestions_id_moderation()} class="bg-base-200 shadow-none">
				<p class="mb-3 text-muted">
					{#if s.visibility === 'hidden'}
						{m.staff_suggestions_id_put_back_board_if_was()}
					{:else}
						<ParaglideMessage
							message={m.staff_suggestions_id_take_off_board_use_above}
							inputs={{ staff_suggestions_id_declined: m.staff_suggestions_id_declined() }}
							>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
								>{/snippet}</ParaglideMessage
						>
					{/if}
				</p>
				<Action
					action={setSuggestionVisibility}
					label={s.visibility === 'hidden'
						? m.staff_suggestions_id_put_back_board()
						: m.staff_suggestions_id_hide_from_board()}
					modalTitle={s.visibility === 'hidden'
						? m.staff_suggestions_id_restore_suggestion()
						: m.staff_suggestions_id_hide_suggestion()}
					submitLabel={m.staff_save()}
					successToast={m.staff_updated()}
					class={s.visibility === 'hidden' ? 'btn-outline btn-sm' : 'btn-error btn-sm'}
					onsuccess={refresh}
				>
					{#snippet form()}
						<input {...setSuggestionVisibility.fields.suggestionId.as('hidden', id)} />
						<input
							{...setSuggestionVisibility.fields.visibility.as(
								'hidden',
								s.visibility === 'hidden' ? 'visible' : 'hidden'
							)}
						/>
						<label class="fieldset w-full">
							<span class="fieldset-legend">
								{s.visibility === 'hidden'
									? m.staff_suggestions_id_reason_shown_member()
									: m.staff_suggestions_id_reason_required_member_shown_can()}
							</span>
							<textarea
								class="textarea w-full"
								rows="3"
								{...setSuggestionVisibility.fields.note.as('text')}></textarea>
						</label>
					{/snippet}
				</Action>
			</InfoCard>

			<InfoCard title={m.staff_suggestions_id_merge()} class="bg-base-200 shadow-none">
				<p class="mb-3 text-muted">
					{m.staff_suggestions_id_fold_into_suggestion_duplicates_its()}
				</p>
				<Action
					action={mergeSuggestion}
					data-testid="merge-suggestion"
					label={m.staff_suggestions_id_merge_into_another()}
					modalTitle={m.staff_suggestions_id_merge_suggestion()}
					submitLabel={m.staff_suggestions_id_merge()}
					successToast={m.staff_suggestions_id_merged()}
					variant="default"
					size="sm"
					outline
					onsuccess={(r) => {
						if (r && typeof r === 'object' && 'targetId' in r) {
							void goto(resolve(`staff/suggestions/${r.targetId as string}`));
						}
					}}
				>
					{#snippet form()}
						<input {...mergeSuggestion.fields.sourceId.as('hidden', id)} />
						<label class="fieldset w-full">
							<span class="fieldset-legend">{m.staff_suggestions_id_merge_into()}</span>
							<Select class="w-full" {...mergeSuggestion.fields.targetId.as('select')}>
								<MergeCandidateOptions {id} />
							</Select>
						</label>
						<p class="mt-3 text-muted">
							{m.staff_suggestions_id_suggestion_comes_off_board_points()}
						</p>
					{/snippet}
				</Action>
			</InfoCard>
		</div>
	{/if}
</PageContent>
