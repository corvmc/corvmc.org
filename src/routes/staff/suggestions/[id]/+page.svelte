<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import {
		suggestionCategoryLabels,
		suggestionStatuses,
		suggestionStatusLabels
	} from '$lib/config';
	import {
		getStaffSuggestionDetail,
		getMergeCandidates,
		respondToSuggestion,
		reviewSuggestion,
		setSuggestionVisibility,
		mergeSuggestion,
		getSuggestionPendingEdit,
		reviewSuggestionEdit
	} from '$lib/remote/suggestions.remote';

	let id = $derived(page.params.id!);

	// Above the `await`s on purpose. Declared after one, `candidates` is compiled
	// as "blocked", and `{#each await candidates}` below then becomes
	// `$.async(node, [blocker], [expression], …)` — the shape that crashes with
	// `null is not an object (evaluating 'c.async_deriveds')` and takes the page
	// down (JAVASCRIPT-SVELTEKIT-25). See the longer note in
	// routes/member/reservations/+page.svelte and the guard in
	// async-effect-shape.spec.ts.
	let candidates = $derived(getMergeCandidates(id));

	let s = $derived(await getStaffSuggestionDetail(id));

	let isMerged = $derived(!!s.mergedIntoId);
	let pendingEdit = $derived(await getSuggestionPendingEdit(id));

	function refresh() {
		void getStaffSuggestionDetail(id).refresh();
		void getSuggestionPendingEdit(id).refresh();
	}
</script>

<PageHeader title={s.title} subtitle="Suggestion" backHref="/staff/suggestions">
	<StatusBadge status={isMerged ? 'merged' : s.status} label />
</PageHeader>

<PageContent width="3xl">
	{#if isMerged}
		<Alert type="info" href={resolve(`/staff/suggestions/${s.mergedIntoId}`)}>
			Merged into <span class="font-medium">{s.mergedIntoTitle ?? 'another suggestion'}</span>. Its
			votes moved across; this one stays off the board.
		</Alert>
	{:else if s.visibility === 'under_review'}
		<!-- One report, one place to decide. Resolving here as well as in the flag
		     queue would let two staff reach opposite conclusions on one report. -->
		<Alert type="warning" href={resolve('/staff/flags')}>
			A member reported this, so it came off the board automatically. Resolve or dismiss the report
			in Content Flags — upholding it also puts the author on review, dismissing puts the suggestion
			straight back up.
		</Alert>
	{:else if s.visibility === 'hidden'}
		<Alert type="error">
			Hidden from the board.{s.visibilityNote ? ` Note: ${s.visibilityNote}` : ''}
		</Alert>
	{/if}

	<InfoCard title="Suggestion">
		<dl class="grid gap-x-4 gap-y-2 text-sm" style="grid-template-columns: auto 1fr;">
			<dt class="opacity-60">Category</dt>
			<dd>
				<Badge size="sm" variant="outline">
					{suggestionCategoryLabels[s.category as keyof typeof suggestionCategoryLabels] ??
						s.category}
				</Badge>
			</dd>

			<dt class="opacity-60">Suggested by</dt>
			<dd>
				{#if s.authorUserId && s.authorName}
					<a class="link" href={resolve(`/staff/users/${s.authorUserId}`)}>{s.authorName}</a>
				{:else}
					A former member
				{/if}
			</dd>

			<dt class="opacity-60">Posted</dt>
			<dd>{formatDateTime(s.createdAt)}</dd>

			<dt class="opacity-60">Votes</dt>
			<dd class="font-medium">{s.voteCount}</dd>
		</dl>
		<p class="mt-3 whitespace-pre-wrap">{s.body}</p>
	</InfoCard>

	{#if s.visibility === 'pending_review'}
		<InfoCard title="Review" class="bg-base-200 shadow-none">
			<p class="mb-3 text-muted">
				This member posts under review, so nobody can see this yet. Approving puts it on the board;
				rejecting hides it. Either way they're told.
			</p>
			<Action
				action={reviewSuggestion}
				label="Approve or reject"
				modalTitle="Review suggestion"
				submitLabel="Save"
				successToast="Reviewed"
				variant="primary"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet form()}
					<input {...reviewSuggestion.fields.suggestionId.as('hidden', id)} />
					<div class="space-y-3">
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Decision</span></div>
							<Select class="w-full" {...reviewSuggestion.fields.decision.as('select')}>
								<option value="approve">Approve — put it on the board</option>
								<option value="reject">Reject — hide it</option>
							</Select>
						</label>
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Note to the member (optional)</span></div>
							<textarea
								class="textarea w-full"
								rows="3"
								{...reviewSuggestion.fields.note.as('text')}
							></textarea>
						</label>
					</div>
				{/snippet}
			</Action>
		</InfoCard>
	{/if}

	{#if pendingEdit}
		<InfoCard title="Proposed edit" class="bg-base-200 shadow-none">
			<p class="mb-3 text-muted">
				{pendingEdit.requestedByName ?? 'The author'} wants to change this after
				{s.voteCount} member{s.voteCount === 1 ? '' : 's'} already voted for it. Approving replaces the
				text below; the votes stay either way.
			</p>

			<!-- Before and after, side by side. Approving a change you can't see is
			     the failure this whole flow exists to prevent. -->
			<div class="grid gap-4 md:grid-cols-2">
				<div>
					<h3 class="mb-1 text-muted font-medium">What members voted for</h3>
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
					<h3 class="mb-1 text-muted font-medium">Proposed</h3>
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
					label="Approve or reject"
					modalTitle="Review the proposed edit"
					submitLabel="Save"
					successToast="Edit reviewed"
					variant="primary"
					size="sm"
					onsuccess={refresh}
				>
					{#snippet form()}
						<input {...reviewSuggestionEdit.fields.suggestionId.as('hidden', id)} />
						<input {...reviewSuggestionEdit.fields.editId.as('hidden', pendingEdit?.id ?? '')} />
						<div class="space-y-3">
							<label class="form-control w-full">
								<div class="label"><span class="label-text">Decision</span></div>
								<Select class="w-full" {...reviewSuggestionEdit.fields.decision.as('select')}>
									<option value="approve">Approve — replace the text</option>
									<option value="reject">Reject — keep what members voted for</option>
								</Select>
							</label>
							<label class="form-control w-full">
								<div class="label">
									<span class="label-text">Note to the member (optional)</span>
								</div>
								<textarea
									class="textarea w-full"
									rows="3"
									{...reviewSuggestionEdit.fields.notes.as('text')}
								></textarea>
							</label>
						</div>
					{/snippet}
				</Action>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title="Response">
		{#if s.responseBody}
			<p class="whitespace-pre-wrap">{s.responseBody}</p>
			<p class="mt-2 text-muted">
				{s.responderName ?? 'Staff'}{s.responseAt ? ` · ${formatDateTime(s.responseAt)}` : ''}
			</p>
		{:else}
			<p class="text-muted">Nobody has written back yet.</p>
		{/if}

		<div class="mt-3">
			<Action
				action={respondToSuggestion}
				label={s.responseBody ? 'Edit response' : 'Respond'}
				modalTitle="Respond to suggestion"
				submitLabel="Save"
				successToast="Response saved"
				variant="primary"
				size="sm"
				onsuccess={refresh}
			>
				{#snippet form()}
					<input {...respondToSuggestion.fields.suggestionId.as('hidden', id)} />
					<div class="space-y-3">
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Status</span></div>
							<Select class="w-full" {...respondToSuggestion.fields.status.as('select', s.status)}>
								{#each suggestionStatuses as st (st)}
									<option value={st}>{suggestionStatusLabels[st]}</option>
								{/each}
							</Select>
						</label>
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Public reply</span></div>
							<textarea
								class="textarea w-full"
								rows="4"
								{...respondToSuggestion.fields.response.as('text', s.responseBody ?? '')}
							></textarea>
						</label>
						<!-- Status and reply are one form on purpose: split, the normal
						     workflow would send the member two notifications for one act. -->
						<p class="text-muted">
							This is shown on the suggestion for everyone to read, and the member who posted it
							gets one notification.
						</p>
					</div>
				{/snippet}
			</Action>
		</div>
	</InfoCard>

	{#if !isMerged}
		<div class="grid gap-6 lg:grid-cols-2">
			<InfoCard title="Moderation" class="bg-base-200 shadow-none">
				<p class="mb-3 text-muted">
					{#if s.visibility === 'hidden'}
						Put this back on the board if it was taken down by mistake.
					{:else}
						Take this off the board. Use <span class="font-medium">Declined</span> above instead if it's
						a real suggestion you're saying no to — a decline is public and explained, a hide just makes
						it vanish.
					{/if}
				</p>
				<Action
					action={setSuggestionVisibility}
					label={s.visibility === 'hidden' ? 'Put back on the board' : 'Hide from the board'}
					modalTitle={s.visibility === 'hidden' ? 'Restore suggestion' : 'Hide suggestion'}
					submitLabel="Save"
					successToast="Updated"
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
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Reason (shown to the member)</span></div>
							<textarea
								class="textarea w-full"
								rows="3"
								{...setSuggestionVisibility.fields.note.as('text')}
							></textarea>
						</label>
					{/snippet}
				</Action>
			</InfoCard>

			<InfoCard title="Merge" class="bg-base-200 shadow-none">
				<p class="mb-3 text-muted">
					Fold this into the suggestion it duplicates. Its votes move across, and anyone who voted
					for both is only counted once.
				</p>
				<Action
					action={mergeSuggestion}
					label="Merge into another"
					modalTitle="Merge suggestion"
					submitLabel="Merge"
					successToast="Merged"
					variant="default"
					size="sm"
					outline
					onsuccess={(r) => {
						if (r && typeof r === 'object' && 'targetId' in r) {
							void goto(resolve(`/staff/suggestions/${r.targetId as string}`));
						}
					}}
				>
					{#snippet form()}
						<input {...mergeSuggestion.fields.sourceId.as('hidden', id)} />
						<label class="form-control w-full">
							<div class="label"><span class="label-text">Merge into</span></div>
							<Select class="w-full" {...mergeSuggestion.fields.targetId.as('select')}>
								{#each await candidates as c (c.id)}
									<option value={c.id}>{c.title} ({c.voteCount})</option>
								{/each}
							</Select>
						</label>
						<p class="mt-3 text-muted">
							This suggestion comes off the board and points at the one you pick. There's no undo.
						</p>
					{/snippet}
				</Action>
			</InfoCard>
		</div>
	{/if}
</PageContent>
