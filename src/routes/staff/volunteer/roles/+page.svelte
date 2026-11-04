<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * What volunteering is made of: the roles members pick from, and the
	 * clearances some of those roles require.
	 *
	 * Two pages before this, and they were only ever visited together — a role
	 * requires a clearance, and a clearance exists because some role requires it.
	 * Side by side, "needs Food Handler" on the left and "required by 1 role" on
	 * the right are the same sentence read from either end.
	 *
	 * Deliberately a browse surface. Editing a role is its own page: a role card
	 * carries what a coordinator needs to *choose* one, and `roles/[id]` carries
	 * everything needed to change it — the requirements picker, the shifts, the
	 * interested list and the feedback rollup, none of which fits in a column.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { Latest } from '#lib/latest.svelte.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import {
		VOLUNTEER_ROLE_DESCRIPTION_MAX,
		CERT_DESCRIPTION_MAX,
		CERT_NAME_MAX,
		volunteerRoleGroups,
		volunteerRoleGroupLabels
	} from '#lib/config.js';
	import {
		getStaffVolunteerSetupPage,
		createVolunteerRole,
		createCertification,
		updateCertification,
		archiveCertification,
		restoreCertification,
		deleteCertification
	} from '#lib/remote/volunteer.remote.js';
	import { IconPencil, IconArchive, IconArchiveOff, IconTrash } from '@tabler/icons-svelte';

	// Not `{#await}`: a refresh would re-pend it and unmount an open New role or
	// New clearance dialog with what was typed in it.
	const data = new Latest(() => getStaffVolunteerSetupPage());
	$effect(() => {
		if (data.error) throw data.error.e;
	});

	const groupOptions = volunteerRoleGroups.map((g) => ({
		value: g,
		label: volunteerRoleGroupLabels[g]
	}));

	const descriptionHelp = m.staff_volunteer_roles_description_help();

	// Retired roles are off by default. They stay listed for staff — the work done
	// under them still resolves everywhere — but a coordinator setting up next
	// month is reading the live list, and last year's roles only pad it.
	let showRetired = $state(page.url.searchParams.get('retired') === '1');

	// `goto(..., { replaceState })`, not `replaceState()`: the latter only rewrites
	// the address bar and the router overwrites that entry on the next navigation.
	$effect(() => {
		const href = withQuery(resolve('/staff/volunteer/roles'), showRetired ? 'retired=1' : '');
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	type Role = Awaited<ReturnType<typeof getStaffVolunteerSetupPage>>['roles'][number];

	// Group order comes from the enum, not from the data, so the sections stay put
	// as roles are added. Empty groups drop out rather than rendering a bare
	// heading — the same call InterestFields makes on the member side.
	function groupedRoles(all: Role[]) {
		const visible = all.filter((r) => showRetired || r.isActive);
		return volunteerRoleGroups
			.map((key) => ({ key, roles: visible.filter((r) => r.group === key) }))
			.filter((g) => g.roles.length > 0);
	}

	/** "8 would do · 12 logs" — what a role is actually worth to the collective. */
	function usage(role: Role): string {
		const parts = [`${role.interested} would do`];
		if (role.logCount > 0) parts.push(`${role.logCount} logs`);
		return parts.join(' · ');
	}

	/** The card both columns are made of — named once rather than spelled twice. */
	const CARD = 'rounded-lg border border-base-300 p-3';

	function validityLabel(months: number | null): string {
		if (!months) return 'never lapses';
		if (months % 12 === 0) return `${months / 12} yr`;
		return `${months} months`;
	}
</script>

<PageHeader title={m.staff_roles()} subtitle={m.staff_volunteering()} />

<PageContent>
	{#if data.current}
		{@const { roles, certifications } = data.current}
		{@const groups = groupedRoles(roles)}
		{@const live = roles.filter((r) => r.isActive).length}

		<div class="grid gap-6 lg:grid-cols-2">
			<div class="flex flex-col gap-4">
				<InfoCard title={m.staff_roles()}>
					{#snippet header()}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>{m.staff_volunteer_roles_roles_live({ live })}</CardTitle>
							<div class="flex items-center gap-2">
								<label class="label cursor-pointer gap-2 text-sm">
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={showRetired}
										onchange={(e) => (showRetired = e.currentTarget.checked)}
									/>
									{m.staff_retired()}
								</label>
								<Action
									action={createVolunteerRole}
									label={m.staff_volunteer_roles_new_role()}
									size="sm"
									modalTitle={m.staff_volunteer_roles_new_volunteer_role()}
									submitLabel={m.staff_create()}
									successToast={m.staff_volunteer_roles_role_created()}
								>
									{#snippet form()}
										<FormField
											field={createVolunteerRole.fields.name}
											label={m.staff_name()}
											type="text"
										/>
										<FormField
											field={createVolunteerRole.fields.description}
											label={m.staff_job_description()}
											type="textarea"
											description={descriptionHelp}
											maxlength={VOLUNTEER_ROLE_DESCRIPTION_MAX}
										/>
										<FormField
											field={createVolunteerRole.fields.group}
											label={m.staff_group()}
											type="select"
											options={groupOptions}
										/>
										<FormField
											field={createVolunteerRole.fields.displayOrder}
											submitAs="text"
											label={m.staff_display_order()}
											type="number"
											value="0"
											description={m.staff_volunteer_roles_lower_sorts_first()}
										/>
									{/snippet}
								</Action>
							</div>
						</div>
					{/snippet}

					{#if groups.length === 0}
						<EmptyState
							title={m.staff_volunteer_roles_no_roles_yet()}
							description={m.staff_volunteer_roles_role_name_plus_what_job()}
						/>
					{:else}
						{#each groups as group (group.key)}
							<SectionLabel label={volunteerRoleGroupLabels[group.key]} />
							<ul class="mb-4 flex flex-col gap-2">
								{#each group.roles as role (role.id)}
									<li>
										<a
											href={resolve(`/staff/volunteer/roles/${role.id}`)}
											class="{CARD} block hover:border-primary"
										>
											<div class="flex flex-wrap items-center gap-2">
												<span class="font-medium">{role.name}</span>
												{#if !role.isActive}
													<Badge variant="ghost" size="xs"
														>{m.staff_volunteer_roles_retired()}</Badge
													>
												{/if}
												{#each role.requiredCertifications as cert (cert.id)}
													<!-- The gate, on the thing it gates. Reading a role
													     without it is how somebody schedules a shift
													     nobody on the list can take. -->
													<Badge variant="info" size="xs"
														>{m.staff_volunteer_roles_needs({ name: cert.name })}</Badge
													>
												{/each}
												{#if role.unfilled > 0}
													<!-- Short shifts are Today's and Schedule's job, but
													     seeing which *role* keeps coming up short is what
													     tells you to go and recruit for it rather than
													     chase one more shift. -->
													<Badge variant="warning" size="xs"
														>{m.staff_volunteer_roles_short({ unfilled: role.unfilled })}</Badge
													>
												{/if}
											</div>
											<div class="text-subtle text-xs">{usage(role)}</div>
											{#if role.description}
												<p class="mt-1 line-clamp-2 text-subtle text-sm">{role.description}</p>
											{/if}
										</a>
									</li>
								{/each}
							</ul>
						{/each}
					{/if}
				</InfoCard>
			</div>

			<div class="flex flex-col gap-4">
				<InfoCard title={m.staff_volunteer_roles_clearances()}>
					{#snippet header()}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle
								>{m.staff_volunteer_roles_clearances_2({
									length: certifications.length
								})}</CardTitle
							>
							<Action
								action={createCertification}
								label={m.staff_volunteer_roles_new_clearance()}
								size="sm"
								modalTitle={m.staff_volunteer_roles_new_clearance_2()}
								submitLabel={m.staff_create()}
								successToast={m.staff_volunteer_roles_clearance_created()}
							>
								{#snippet form()}
									<FormField
										field={createCertification.fields.name}
										label={m.staff_name()}
										type="text"
										maxlength={CERT_NAME_MAX}
									/>
									<FormField
										field={createCertification.fields.description}
										label={m.staff_volunteer_roles_what_covers()}
										type="textarea"
										maxlength={CERT_DESCRIPTION_MAX}
									/>
									<FormField
										field={createCertification.fields.issuedBy}
										label={m.staff_volunteer_roles_issued_by()}
										type="text"
										description={m.staff_volunteer_roles_leave_blank_something_cmc_signs()}
									/>
									<FormField
										field={createCertification.fields.validityMonths}
										submitAs="text"
										label={m.staff_volunteer_roles_valid_months()}
										type="number"
										description={m.staff_volunteer_roles_blank_means_never_lapses_changing()}
									/>
								{/snippet}
							</Action>
						</div>
					{/snippet}

					{#if certifications.length === 0}
						<EmptyState
							title={m.staff_volunteer_roles_no_clearances_yet()}
							description={m.staff_volunteer_roles_clearance_something_volunteer_must_hol()}
						/>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each certifications as cert (cert.id)}
								<li class={CARD}>
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-medium">{cert.name}</span>
										{#if !cert.isActive}
											<Badge variant="ghost" size="xs">{m.staff_volunteer_roles_retired()}</Badge>
										{/if}
									</div>
									<div class="text-subtle text-xs">
										{cert.issuedBy ?? m.staff_cmc()} · {validityLabel(cert.validityMonths)}
									</div>
									<div class="text-subtle text-xs">
										{m.staff_volunteer_roles_hold_required_by_roles({
											holderCount: cert.holderCount,
											roleCount: cert.roleCount
										})}
									</div>
									<div class="mt-2 flex flex-wrap gap-1">
										<Action
											action={updateCertification.for(cert.id)}
											label={m.staff_edit()}
											iconOnly
											icon={pencilIcon}
											variant="ghost"
											size="xs"
											modalTitle={m.staff_edit_2({ name: cert.name })}
											successToast={m.staff_volunteer_roles_clearance_updated()}
										>
											{#snippet form()}
												<input
													{...updateCertification.for(cert.id).fields.id.as('hidden', cert.id)}
												/>
												<FormField
													field={updateCertification.for(cert.id).fields.name}
													label={m.staff_name()}
													type="text"
													value={cert.name}
												/>
												<FormField
													field={updateCertification.for(cert.id).fields.description}
													label={m.staff_volunteer_roles_what_covers()}
													type="textarea"
													value={cert.description ?? ''}
													maxlength={CERT_DESCRIPTION_MAX}
												/>
												<FormField
													field={updateCertification.for(cert.id).fields.issuedBy}
													label={m.staff_volunteer_roles_issued_by()}
													type="text"
													value={cert.issuedBy ?? ''}
													description={m.staff_volunteer_roles_leave_blank_something_cmc_signs()}
												/>
												<FormField
													field={updateCertification.for(cert.id).fields.validityMonths}
													submitAs="text"
													label={m.staff_volunteer_roles_valid_months()}
													type="number"
													min="1"
													value={cert.validityMonths ? String(cert.validityMonths) : ''}
													description={m.staff_volunteer_roles_blank_means_never_lapses_changing_2({
														holderCount: cert.holderCount
													})}
												/>
												<FormField
													field={updateCertification.for(cert.id).fields.displayOrder}
													submitAs="text"
													label={m.staff_display_order()}
													type="number"
													value={String(cert.displayOrder)}
												/>
											{/snippet}
										</Action>

										{#if cert.isActive}
											<Action
												action={archiveCertification.for(cert.id)}
												label={m.staff_archive()}
												iconOnly
												icon={archiveIcon}
												variant="ghost"
												size="xs"
												modalTitle={m.staff_archive_2({ name: cert.name })}
												submitLabel={m.staff_archive()}
												successToast={m.staff_volunteer_roles_clearance_archived()}
											>
												{#snippet form()}
													<input
														{...archiveCertification.for(cert.id).fields.id.as('hidden', cert.id)}
													/>
													<p class="text-sm">
														{m.staff_volunteer_roles_disappears_from_grant_form_everyone()}
													</p>
												{/snippet}
											</Action>
										{:else}
											<Action
												action={restoreCertification.for(cert.id)}
												label={m.staff_restore()}
												iconOnly
												icon={unarchiveIcon}
												variant="ghost"
												size="xs"
												modalTitle={m.staff_restore_2({ name: cert.name })}
												submitLabel={m.staff_restore()}
												successToast={m.staff_volunteer_roles_clearance_restored()}
											>
												{#snippet form()}
													<input
														{...restoreCertification.for(cert.id).fields.id.as('hidden', cert.id)}
													/>
													<p class="text-sm">
														{m.staff_volunteer_roles_staff_will_able_grant_again()}
													</p>
												{/snippet}
											</Action>
										{/if}

										<!--
											Delete only when nobody holds it. A held clearance is the
											record of who was cleared and when, which is the whole
											reason the FK restricts.
										-->
										{#if cert.holderCount === 0}
											<Action
												action={deleteCertification.for(cert.id)}
												label={m.staff_delete()}
												iconOnly
												icon={trashIcon}
												variant="ghost"
												size="xs"
												class="text-error"
												modalTitle={m.staff_delete_2({ name: cert.name })}
												submitLabel={m.staff_delete()}
												submitVariant="error"
												successToast={m.staff_volunteer_roles_clearance_deleted()}
											>
												{#snippet form()}
													<input
														{...deleteCertification.for(cert.id).fields.id.as('hidden', cert.id)}
													/>
													<p class="text-sm">
														{m.staff_volunteer_roles_nobody_holds_so_can_removed()}
													</p>
												{/snippet}
											</Action>
										{/if}
									</div>

									{#if cert.lapsingBeforeShift > 0}
										<!-- The one thing on this screen that is a person rather
										     than a definition, so it links to the people. -->
										<a
											href={resolve('/staff/volunteer')}
											class="mt-1 inline-block link text-xs text-warning"
										>
											{m.staff_volunteer_roles_lapse_before_booked_shift({
												lapsingBeforeShift: cert.lapsingBeforeShift
											})}
										</a>
									{/if}
								</li>
							{/each}
						</ul>
						<p class="mt-3 text-subtle text-xs">
							{m.staff_volunteer_roles_grants_made_person_s_record()}
						</p>
					{/if}
				</InfoCard>

				<Button href={resolve('/staff/members/volunteers')} variant="ghost" size="sm">
					{m.staff_volunteer_roles_see_who_s_cleared()}
				</Button>
			</div>
		</div>
	{/if}
</PageContent>

{#snippet pencilIcon()}
	<IconPencil size={16} />
{/snippet}

{#snippet archiveIcon()}
	<IconArchive size={16} />
{/snippet}

{#snippet unarchiveIcon()}
	<IconArchiveOff size={16} />
{/snippet}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
