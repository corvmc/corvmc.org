<script lang="ts">
	/**
	 * The volunteer profile: contact info, preferred roles and the hour history,
	 * under a line for each clearance that is expiring or has lapsed.
	 *
	 * "Returned", never "rejected": it is a request for a correction, not a
	 * judgement, and the stored value differs from the label on purpose.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form, { SubmitButton } from '$lib/components/ui/Form';
	import ProfileFields from '$lib/components/volunteer/ProfileFields.svelte';
	import InterestFields from '$lib/components/volunteer/InterestFields.svelte';
	import LogHoursAction from '$lib/components/volunteer/LogHoursAction.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { formatVolunteerHours, volunteerHourStatusLabels, DEFAULT_TIMEZONE } from '$lib/config';
	import {
		getMemberVolunteerProfilePage,
		saveVolunteerInterests,
		updateVolunteerProfile,
		withdrawVolunteerHours
	} from '$lib/remote/volunteer.remote';

	// `{#await}` rather than a top-level await: this page renders forms, and a
	// top-level await async-gates their bindings.
	const pageData = $derived(getMemberVolunteerProfilePage());

	function toDateInput(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date(date));
	}

	const pip: Record<string, string> = {
		approved: 'bg-success',
		pending: 'bg-warning',
		rejected: 'bg-error'
	};
</script>

<PageHeader width="3xl" title="Profile" subtitle="Volunteering" />

<PageContent width="3xl">
	{#await pageData then data}
		{#each data.renew as c (c.name)}
			<p class="text-sm text-warning">
				{c.name}
				{c.state === 'expired'
					? 'has lapsed'
					: `expires ${c.expiresAt ? formatDateShort(c.expiresAt) : 'soon'}`}. Staff renew these.
			</p>
		{/each}
		<InfoCard title="Contact info">
			<Form remote={updateVolunteerProfile} successToast="Profile updated">
				<ProfileFields
					fields={updateVolunteerProfile.fields}
					firstName={data.access.firstName}
					lastName={data.access.lastName}
					pronouns={data.access.pronouns}
					phone={data.access.phone}
					email={data.access.email}
				/>
				<div class="flex justify-end">
					<SubmitButton label="Save" successLabel="Saved" variant="primary" />
				</div>
			</Form>
		</InfoCard>

		<InfoCard title="Preferred roles">
			{#if data.roles.length === 0}
				<p class="text-muted">No volunteer roles are open right now.</p>
			{:else}
				<Form remote={saveVolunteerInterests} successToast="Saved">
					<InterestFields
						fields={saveVolunteerInterests.fields}
						roleOptions={data.roles}
						selected={data.interests}
						availability={data.access.availability}
					/>
					<div class="flex justify-end">
						<SubmitButton label="Save" successLabel="Saved" variant="primary" />
					</div>
				</Form>
			{/if}
		</InfoCard>

		<InfoCard title="Volunteer Hours">
			{#snippet action()}
				<LogHoursAction
					roles={data.roles}
					programs={data.programs}
					label="Log Hours"
					variant="primary"
					size="sm"
				/>
			{/snippet}
			{#if data.logs.length === 0}
				<EmptyState title="Nothing filed yet" />
			{:else}
				<ul class="flex flex-col gap-3">
					{#each data.logs as log (log.id)}
						<li
							class="rounded-lg border border-base-300 p-3"
							class:bg-error-content={log.status === 'rejected'}
						>
							<div class="flex flex-wrap items-center gap-2">
								<span class="size-2 rounded-full {pip[log.status]}"></span>
								<span class="font-medium">{log.roleName}</span>
								<Badge
									variant={log.status === 'approved'
										? 'success'
										: log.status === 'rejected'
											? 'error'
											: 'warning'}
									size="sm"
								>
									{volunteerHourStatusLabels[log.status]}
								</Badge>
								<span class="ml-auto text-subtle text-sm">
									{formatVolunteerHours(log.minutes)} · {formatDateShort(log.workedOn)}
								</span>
							</div>

							<p class="mt-1 text-sm">{log.description}</p>

							{#if log.status === 'rejected' && log.reviewNotes}
								<!-- In full, never truncated: it is the instruction for what to
								     change, and a clipped one sends them back to guess. -->
								<p class="mt-2 text-sm text-error">{log.reviewNotes}</p>
							{/if}

							{#if log.status !== 'approved'}
								<div class="mt-2 flex flex-wrap gap-2">
									<LogHoursAction
										mode="fix"
										size="xs"
										label={log.status === 'rejected' ? 'Fix it' : 'Edit'}
										log={{
											id: log.id,
											volunteerRoleId: log.volunteerRoleId,
											workedOn: toDateInput(log.workedOn),
											hours: String(log.minutes / 60),
											description: log.description
										}}
									/>
									<Action
										action={withdrawVolunteerHours.for(log.id)}
										label="Withdraw"
										variant="ghost"
										size="xs"
										class="text-error"
										modalTitle="Withdraw this log?"
										submitLabel="Withdraw"
										submitVariant="error"
										successToast="Withdrawn"
									>
										{#snippet form()}
											<input type="hidden" name="id" value={log.id} />
											<p class="text-sm">It comes off the record. File it again any time.</p>
										{/snippet}
									</Action>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/await}
</PageContent>
