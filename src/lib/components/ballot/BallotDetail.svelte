<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * One ballot, for everyone who can see it: the vote for an elector, the
	 * result once it may be read, and the draft controls for its managers.
	 * Mounted by `/member/ballots/[id]` and `/staff/ballots/[id]`.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { startProjectFromBallotForm } from '#lib/remote/projects.remote.js';
	import { ballotKindLabels, ballotStatusLabels, DEFAULT_TIMEZONE } from '#lib/config.js';
	import { formatDateTime, formatDateShortYear } from '#lib/utils/format.js';
	import {
		cancelBallotForm,
		castBallotVote,
		certifyBallotForm,
		changeBallotCertifier,
		openBallotForm,
		setElectorOverrideForm,
		updateBallotDraft,
		type getBallotPage
	} from '#lib/remote/ballots.remote.js';

	type Page = Awaited<ReturnType<typeof getBallotPage>>;

	let { data, panel }: { data: Page; panel: 'member' | 'staff' } = $props();

	// Above anything async-gated, as on the staff suggestion page.
	const startFields = startProjectFromBallotForm.fields;

	const b = $derived(data.ballot);
	const viewer = $derived(data.viewer);
	const secret = $derived(b.kind === 'member');
	const optionLabel = $derived(new Map(b.options.map((o) => [o.id, o.label])));
	const voteOptions = $derived(b.options.map((o) => ({ value: o.id, label: o.label })));
	const outcomeOptions = [
		{ value: 'passed', label: msg.ballot_ballot_detail_passed_authorises_work_label() },
		{ value: 'not_passed', label: msg.ballot_ballot_detail_not_passed_label() }
	];
	const certifierOptions = $derived(
		(data.certifierChoices ?? []).map((m) => ({ value: m.id, label: m.name }))
	);

	/** The draft's close day, as the date field wants it, in the collective's zone. */
	const closesOn = $derived(
		new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(b.closesAt)
	);

	let overrideUserId = $state('');
	let overrideUserName = $state('');
	let certifierId = $state('');
	let certifierName = $state('');

	const decides = $derived(data.decides);
	const suggestionHref = $derived(
		decides.suggestion
			? panel === 'staff' && viewer.canReadSuggestions
				? resolve(`staff/suggestions/${decides.suggestion.id}`)
				: resolve(`member/suggestions/${decides.suggestion.id}`)
			: null
	);
	const projectHref = (id: string) =>
		viewer.canReadProjects ? resolve(`staff/projects/${id}`) : null;

	function share(votes: number, turnout: number) {
		return turnout === 0 ? '—' : `${Math.round((votes / turnout) * 100)}%`;
	}
</script>

<PageHeader title={b.title} subtitle={b.group?.name ?? ballotKindLabels[b.kind]} width="3xl">
	{#if viewer.isManager && b.status === 'draft'}
		<Action
			action={updateBallotDraft}
			label={msg.ballot_ballot_detail_edit_label()}
			modalTitle={msg.ballot_ballot_detail_edit_draft_title()}
			submitLabel={msg.ballot_ballot_detail_save_label()}
			successToast={msg.ballot_ballot_detail_draft_saved_toast()}
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...updateBallotDraft.fields.ballotId.as('hidden', b.id)} />
				<FormField
					field={updateBallotDraft.fields.title}
					type="text"
					label={msg.ballot_ballot_detail_question_label()}
					value={b.title}
				/>
				<FormField
					field={updateBallotDraft.fields.description}
					type="textarea"
					label={msg.ballot_ballot_detail_background_optional_label()}
					value={b.description ?? ''}
				/>
				<FormField
					field={updateBallotDraft.fields.options}
					type="textarea"
					label={msg.ballot_ballot_detail_choices_label()}
					description={msg.ballot_ballot_detail_one_per_line_between_2_body()}
					value={b.options.map((o) => o.label).join('\n')}
				/>
				<FormField
					field={updateBallotDraft.fields.closesOn}
					type="date"
					label={msg.ballot_ballot_detail_voting_closes_at_end_label()}
					value={closesOn}
				/>
				{#if b.kind === 'group'}
					<FormField
						field={updateBallotDraft.fields.certifierId}
						type="select"
						label={msg.ballot_ballot_detail_certifier_label()}
						options={certifierOptions}
						value={b.certifier?.id ?? ''}
					/>
				{:else}
					<input {...updateBallotDraft.fields.certifierId.as('hidden', b.certifier?.id ?? '')} />
				{/if}
			{/snippet}
		</Action>
		<Action
			action={openBallotForm}
			label={msg.ballot_ballot_detail_open_voting_label()}
			modalTitle={msg.ballot_ballot_detail_open_voting_title()}
			submitLabel={msg.ballot_ballot_detail_open_label()}
			successToast={msg.ballot_ballot_detail_voting_open_toast()}
			size="sm"
		>
			{#snippet form()}
				<input {...openBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p>
					{msg.ballot_ballot_detail_opening_freezes_roll_people_can_text({
						value: data.previewSize ?? 0,
						count: data.previewSize ?? 0
					})}
				</p>
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isManager && (b.status === 'open' || b.status === 'closed')}
		<Action
			action={changeBallotCertifier}
			label={msg.ballot_ballot_detail_change_certifier_label()}
			modalTitle={msg.ballot_ballot_detail_change_certifier_2_title()}
			submitLabel={msg.ballot_ballot_detail_save_label()}
			successToast={msg.ballot_ballot_detail_certifier_changed_toast()}
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...changeBallotCertifier.fields.ballotId.as('hidden', b.id)} />
				{#if b.kind === 'group'}
					<FormField
						field={changeBallotCertifier.fields.certifierId}
						type="select"
						label={msg.ballot_ballot_detail_certifier_label()}
						options={certifierOptions}
						value={b.certifier?.id ?? ''}
					/>
				{:else}
					<MemberPicker
						field={changeBallotCertifier.fields.certifierId}
						label={msg.ballot_ballot_detail_certifier_label()}
						bind:value={certifierId}
						bind:name={certifierName}
					/>
				{/if}
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isManager && b.status !== 'certified' && b.status !== 'cancelled'}
		<Action
			action={cancelBallotForm}
			label={msg.ballot_ballot_detail_cancel_ballot_label()}
			modalTitle={msg.ballot_ballot_detail_cancel_ballot_2_title()}
			submitLabel={msg.ballot_ballot_detail_cancel_ballot_label()}
			submitVariant="error"
			successToast={msg.ballot_ballot_detail_ballot_cancelled_toast()}
			variant="error"
			outline
			size="sm"
		>
			{#snippet form()}
				<input {...cancelBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p class="mb-3">
					{msg.ballot_ballot_detail_cancelling_final_no_result_ever_text()}
				</p>
				<FormField
					field={cancelBallotForm.fields.reason}
					type="textarea"
					label={msg.ballot_ballot_detail_why_label()}
				/>
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isCertifier && (b.status === 'closed' || data.needsOutcome)}
		<Action
			action={certifyBallotForm}
			label={data.needsOutcome
				? msg.ballot_ballot_detail_record_outcome_label()
				: msg.ballot_ballot_detail_certify_result_label()}
			modalTitle={data.needsOutcome
				? msg.ballot_ballot_detail_record_outcome_title()
				: msg.ballot_ballot_detail_certify_result_title()}
			submitLabel={data.needsOutcome
				? msg.ballot_ballot_detail_record_label()
				: msg.ballot_ballot_detail_certify_label()}
			successToast={data.needsOutcome
				? msg.ballot_ballot_detail_outcome_recorded_toast()
				: msg.ballot_ballot_detail_result_certified_published_toast()}
			size="sm"
		>
			{#snippet form()}
				<input {...certifyBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p class="mb-3">
					{#if data.needsOutcome}{msg.ballot_ballot_detail_result_was_certified_before_outcome_text()}{:else}{msg.ballot_ballot_detail_certifying_fixes_result_below_as_text()}{/if}
				</p>
				<FormField
					field={certifyBallotForm.fields.outcome}
					type="select"
					label={msg.ballot_ballot_detail_outcome_label()}
					placeholder={msg.ballot_ballot_detail_placeholder()}
					options={outcomeOptions}
					description={msg.ballot_ballot_detail_call_not_leading_choice_not_body()}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if decides.suggestion || decides.project || data.authorised || data.startProject}
		<InfoCard title={msg.ballot_ballot_detail_what_decides_title()}>
			<DefinitionList>
				{#if decides.suggestion}
					<Fact label={msg.ballot_ballot_detail_suggestion_label()}>
						<a class="link" href={suggestionHref}>{decides.suggestion.title}</a>
						<StatusBadge status={decides.suggestion.status} label />
					</Fact>
				{/if}
				{#if decides.project}
					{@const href = projectHref(decides.project.id)}
					<Fact label={msg.ballot_ballot_detail_project_label()}>
						{#if href}<a class="link" {href}>{decides.project.name}</a>{:else}{decides.project
								.name}{/if}
					</Fact>
				{/if}
				{#if b.status === 'certified'}
					<Fact
						label={msg.ballot_ballot_detail_outcome_label()}
						value={data.passed === null
							? 'Not recorded by the certifier'
							: data.passed
								? 'Passed'
								: 'Did not pass'}
					/>
				{/if}
				{#if data.authorised}
					{@const href = projectHref(data.authorised.id)}
					<Fact label={msg.ballot_ballot_detail_became_project_label()}>
						{#if href}<a class="link" {href}>{data.authorised.name}</a>{:else}{data.authorised
								.name}{/if}
						<StatusBadge status={data.authorised.status} label />
					</Fact>
				{/if}
			</DefinitionList>
			{#if data.startProject}
				{@const start = data.startProject}
				<div class="mt-3">
					<Action
						action={startProjectFromBallotForm}
						label={msg.ballot_ballot_detail_start_project_label()}
						modalTitle={msg.ballot_ballot_detail_start_project_ballot_authorised_title()}
						submitLabel={msg.ballot_ballot_detail_start_label()}
						successToast={msg.ballot_ballot_detail_project_started_toast()}
						variant="primary"
						size="sm"
						onsuccess={(r) => {
							if (r && typeof r === 'object' && 'id' in r) {
								void goto(resolve(`staff/projects/${r.id as string}`));
							}
						}}
					>
						{#snippet form()}
							<input {...startFields.ballotId.as('hidden', b.id)} />
							<p class="mb-3 text-muted">
								{(decides.suggestion
									? msg.ballot_ballot_detail_project_linked_ballot_suggestion_decide_text
									: msg.ballot_ballot_detail_project_linked_ballot_text)()}
							</p>
							<Field
								field={startFields.name}
								type="text"
								label={msg.ballot_ballot_detail_project_name_label()}
								value={start.name}
							/>
							<Field
								field={startFields.groupId}
								type="select"
								label={msg.ballot_ballot_detail_owning_committee_label()}
								placeholder={msg.ui_none_placeholder()}
								options={start.committees.map((c) => ({ value: c.id, label: c.name }))}
								description={msg.ballot_ballot_detail_only_committee_can_own_project_body()}
							/>
							<MoneyField
								field={startFields.budgetCents}
								label={msg.ballot_ballot_detail_budget_label()}
							/>
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}

	{#if b.status === 'cancelled'}
		<Alert type="warning"
			>{msg.ballot_ballot_detail_ballot_was_cancelled_body({
				cancelReason: b.cancelReason ?? ''
			})}</Alert
		>
	{:else if b.status === 'certified' && b.certifiedAt}
		<Alert type="success">
			{msg.ballot_ballot_detail_certified_by_body({
				value: b.certifier?.name ?? msg.ballot_ballot_detail_certifier_2_text(),
				formatDateShortYear: formatDateShortYear(b.certifiedAt)
			})}
		</Alert>
	{:else if b.status === 'closed'}
		<Alert type="info">
			{viewer.isCertifier
				? msg.ballot_ballot_detail_closed_certify_body()
				: msg.ballot_ballot_detail_closed_waiting_body({
						name: b.certifier?.name ?? msg.ballot_ballot_detail_certifier_2_text()
					})}
		</Alert>
	{/if}

	{#if b.description}
		<InfoCard title={msg.ballot_ballot_detail_background_title()}>
			<p class="whitespace-pre-wrap">{b.description}</p>
		</InfoCard>
	{/if}

	{#if viewer.isElector && b.status === 'open'}
		<InfoCard title={msg.ballot_ballot_detail_vote_title()}>
			{#if secret && data.myVote?.voted}
				<p>
					{msg.ballot_ballot_detail_vote_secret_app_records_voted_text()}
				</p>
			{:else}
				{#if data.myVote?.optionId}
					<p class="mb-3">
						<ParaglideMessage
							message={msg.ballot_ballot_detail_voted_recorded_vote_can_change_text}
							inputs={{ option: optionLabel.get(data.myVote.optionId) ?? '' }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{:else if secret}
					<p class="mb-3">
						{msg.ballot_ballot_detail_secret_ballot_nobody_will_able_text()}
					</p>
				{:else}
					<p class="mb-3">
						{msg.ballot_ballot_detail_recorded_vote_once_voting_closes_text()}
					</p>
				{/if}
				<Form remote={castBallotVote} successToast={msg.ballot_ballot_detail_vote_recorded_toast()}>
					<input {...castBallotVote.fields.ballotId.as('hidden', b.id)} />
					<FormField
						field={castBallotVote.fields.optionId}
						type="select"
						label={msg.ballot_ballot_detail_choice_label()}
						placeholder={msg.ballot_ballot_detail_placeholder()}
						options={voteOptions}
						value={data.myVote?.optionId ?? ''}
					/>
					<SubmitButton
						label={data.myVote?.optionId
							? msg.ballot_ballot_detail_change_my_vote_label()
							: msg.ballot_ballot_detail_cast_my_vote_label()}
					/>
				</Form>
			{/if}
		</InfoCard>
	{/if}

	{#if data.tally}
		<InfoCard
			title={b.status === 'certified'
				? msg.ballot_ballot_detail_certified_result_title()
				: msg.ballot_ballot_detail_result_title()}
		>
			<Table>
				{#snippet head()}
					<th>{msg.ballot_ballot_detail_choice_2_label()}</th>
					<th class="cell-num">{msg.ballot_ballot_detail_votes_label()}</th>
					<th class="cell-num">{msg.ballot_ballot_detail_share_label()}</th>
				{/snippet}
				{#each data.tally.options as o (o.optionId)}
					<tr>
						<td class="cell-primary">{o.label}</td>
						<td class="cell-num">{o.votes}</td>
						<td class="cell-num">{share(o.votes, data.tally.turnout)}</td>
					</tr>
				{/each}
			</Table>
			<p class="mt-3 text-muted">
				{msg.ballot_ballot_detail_roll_voted_text({
					turnout: data.tally.turnout,
					electorateSize: data.tally.electorateSize
				})}
			</p>
		</InfoCard>

		{#if data.tally.rollCall}
			<InfoCard title={msg.ballot_ballot_detail_roll_call_title()}>
				{#if data.tally.rollCall.length === 0}
					<EmptyState title={msg.ballot_ballot_detail_nobody_voted_title()} />
				{:else}
					<Table>
						{#snippet head()}
							<th>{msg.ballot_ballot_detail_member_label()}</th>
							<th>{msg.ballot_ballot_detail_vote_2_label()}</th>
						{/snippet}
						{#each data.tally.rollCall as r (r.userId)}
							<tr>
								<td class="cell-primary">{r.name}</td>
								<td>{optionLabel.get(r.optionId) ?? '—'}</td>
							</tr>
						{/each}
					</Table>
				{/if}
			</InfoCard>
		{/if}
	{/if}

	<InfoCard title={msg.ballot_ballot_detail_details_title()}>
		<DefinitionList>
			<Fact label={msg.ballot_ballot_detail_status_label()}>
				<StatusBadge status={b.status} label text={ballotStatusLabels[b.status]} />
			</Fact>
			<Fact label={msg.ballot_ballot_detail_kind_label()} value={ballotKindLabels[b.kind]} />
			{#if b.group}
				<Fact label={msg.ballot_ballot_detail_committee_label()} value={b.group.name} />
			{/if}
			<Fact
				label={msg.ballot_ballot_detail_choices_label()}
				value={b.options.map((o) => o.label).join(' · ')}
			/>
			<Fact label={msg.ballot_ballot_detail_closes_label()} value={formatDateTime(b.closesAt)} />
			<Fact
				label={msg.ballot_ballot_detail_certifier_label()}
				value={b.certifier?.name ?? 'Nobody named yet'}
			/>
			{#if b.status === 'draft' && data.previewSize !== null}
				<Fact
					label={msg.ballot_ballot_detail_roll_if_opened_now_label()}
					value={String(data.previewSize)}
				/>
			{:else if b.electorateSize !== null}
				<Fact label={msg.ballot_ballot_detail_roll_label()} value={String(b.electorateSize)} />
			{/if}
			{#if data.turnout}
				<Fact
					label={msg.ballot_ballot_detail_voted_so_far_label()}
					value={`${data.turnout.voted} of ${data.turnout.electorateSize}`}
				/>
			{/if}
		</DefinitionList>
	</InfoCard>

	{#if data.overrides && (b.status === 'draft' || b.status === 'open' || data.overrides.length > 0)}
		<InfoCard title={msg.ballot_ballot_detail_roll_overrides_title()}>
			<p class="mb-3 text-muted">
				{msg.ballot_ballot_detail_put_member_roll_rule_leaves_text()}
			</p>
			{#if data.overrides.length > 0}
				<Table>
					{#snippet head()}
						<th>{msg.ballot_ballot_detail_member_label()}</th>
						<th>{msg.ballot_ballot_detail_override_label()}</th>
						<th>{msg.ballot_ballot_detail_reason_label()}</th>
					{/snippet}
					{#each data.overrides as o (o.userId)}
						<tr>
							<td class="cell-primary">{o.name}</td>
							<td class="whitespace-nowrap"
								>{o.include
									? msg.ballot_ballot_detail_added_text()
									: msg.ballot_ballot_detail_removed_text()}</td
							>
							<td>{o.reason}</td>
						</tr>
					{/each}
				</Table>
			{/if}
			{#if b.status === 'draft' || b.status === 'open'}
				<div class="mt-3">
					<Action
						action={setElectorOverrideForm}
						label={msg.ballot_ballot_detail_override_roll_label()}
						modalTitle={msg.ballot_ballot_detail_override_roll_title()}
						submitLabel={msg.ballot_ballot_detail_save_label()}
						successToast={msg.ballot_ballot_detail_roll_updated_toast()}
						variant="ghost"
						size="sm"
					>
						{#snippet form()}
							<input {...setElectorOverrideForm.fields.ballotId.as('hidden', b.id)} />
							<MemberPicker
								field={setElectorOverrideForm.fields.userId}
								bind:value={overrideUserId}
								bind:name={overrideUserName}
							/>
							<FormField
								field={setElectorOverrideForm.fields.include}
								type="select"
								label={msg.ballot_ballot_detail_change_label()}
								options={[
									{ value: 'include', label: msg.ballot_ballot_detail_add_roll_label() },
									{ value: 'exclude', label: msg.ballot_ballot_detail_take_off_roll_label() }
								]}
							/>
							<FormField
								field={setElectorOverrideForm.fields.reason}
								type="textarea"
								label={msg.ballot_ballot_detail_why_label()}
							/>
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
