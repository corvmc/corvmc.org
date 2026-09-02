<script lang="ts">
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
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import {
		VOLUNTEER_ROLE_DESCRIPTION_MAX,
		CERT_DESCRIPTION_MAX,
		CERT_NAME_MAX,
		volunteerRoleGroups,
		volunteerRoleGroupLabels
	} from '$lib/config';
	import {
		getStaffVolunteerSetupPage,
		createVolunteerRole,
		createCertification,
		updateCertification,
		archiveCertification,
		restoreCertification,
		deleteCertification
	} from '$lib/remote/volunteer.remote';
	import { IconPencil, IconArchive, IconArchiveOff, IconTrash } from '@tabler/icons-svelte';

	const data = $derived(getStaffVolunteerSetupPage());

	const groupOptions = volunteerRoleGroups.map((g) => ({
		value: g,
		label: volunteerRoleGroupLabels[g]
	}));

	const descriptionHelp =
		'Markdown. This is what members read on their volunteering page, so say what the job actually involves.';

	// Retired roles are off by default. They stay listed for staff — the work done
	// under them still resolves everywhere — but a coordinator setting up next
	// month is reading the live list, and last year's roles only pad it.
	let showRetired = $state(page.url.searchParams.get('retired') === '1');

	// `goto(..., { replaceState })`, not `replaceState()`: the latter only rewrites
	// the address bar and the router overwrites that entry on the next navigation.
	$effect(() => {
		const href = `${resolve('/staff/volunteer/setup')}${showRetired ? '?retired=1' : ''}`;
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

<PageHeader title="Setup" subtitle="Volunteering" backHref="/staff/volunteer" />

<PageContent>
	{#await data then { roles, certifications }}
		{@const groups = groupedRoles(roles)}
		{@const live = roles.filter((r) => r.isActive).length}

		<div class="grid gap-6 lg:grid-cols-2">
			<div class="flex flex-col gap-4">
				<InfoCard title="Roles">
					{#snippet header()}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>Roles · {live} live</CardTitle>
							<div class="flex items-center gap-2">
								<label class="label cursor-pointer gap-2 text-sm">
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={showRetired}
										onchange={(e) => (showRetired = e.currentTarget.checked)}
									/>
									Retired
								</label>
								<Action
									action={createVolunteerRole}
									label="New Role"
									size="sm"
									modalTitle="New volunteer role"
									submitLabel="Create"
									successToast="Role created"
								>
									{#snippet form()}
										<FormField name="name" label="Name" type="text" />
										<FormField
											name="description"
											label="Job description"
											type="textarea"
											description={descriptionHelp}
											maxlength={VOLUNTEER_ROLE_DESCRIPTION_MAX}
										/>
										<FormField name="group" label="Group" type="select" options={groupOptions} />
										<FormField
											name="displayOrder"
											label="Display order"
											type="number"
											value="0"
											description="Lower sorts first."
										/>
									{/snippet}
								</Action>
							</div>
						</div>
					{/snippet}

					{#if groups.length === 0}
						<EmptyState
							title="No roles yet"
							description="A role is a name plus what the job involves. Members pick from this list."
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
													<Badge variant="ghost" size="xs">retired</Badge>
												{/if}
												{#each role.requiredCertifications as cert (cert.id)}
													<!-- The gate, on the thing it gates. Reading a role
													     without it is how somebody schedules a shift
													     nobody on the list can take. -->
													<Badge variant="info" size="xs">needs {cert.name}</Badge>
												{/each}
												{#if role.unfilled > 0}
													<!-- Short shifts are Today's and Schedule's job, but
													     seeing which *role* keeps coming up short is what
													     tells you to go and recruit for it rather than
													     chase one more shift. -->
													<Badge variant="warning" size="xs">{role.unfilled} short</Badge>
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
				<InfoCard title="Clearances">
					{#snippet header()}
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>Clearances · {certifications.length}</CardTitle>
							<Action
								action={createCertification}
								label="New Clearance"
								size="sm"
								modalTitle="New clearance"
								submitLabel="Create"
								successToast="Clearance created"
							>
								{#snippet form()}
									<FormField name="name" label="Name" type="text" maxlength={CERT_NAME_MAX} />
									<FormField
										name="description"
										label="What it covers"
										type="textarea"
										maxlength={CERT_DESCRIPTION_MAX}
									/>
									<FormField
										name="issuedBy"
										label="Issued by"
										type="text"
										description="Leave blank for something CMC signs off itself."
									/>
									<FormField
										name="validityMonths"
										label="Valid for (months)"
										type="number"
										description="Blank means it never lapses. Changing this affects future grants only — an existing grant keeps the expiry it was stamped with."
									/>
								{/snippet}
							</Action>
						</div>
					{/snippet}

					{#if certifications.length === 0}
						<EmptyState
							title="No clearances yet"
							description="A clearance gates the roles that require it, judged as of each shift's own date."
						/>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each certifications as cert (cert.id)}
								<li class={CARD}>
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-medium">{cert.name}</span>
										{#if !cert.isActive}
											<Badge variant="ghost" size="xs">retired</Badge>
										{/if}
									</div>
									<div class="text-subtle text-xs">
										{cert.issuedBy ?? 'CMC'} · {validityLabel(cert.validityMonths)}
									</div>
									<div class="text-subtle text-xs">
										{cert.holderCount} hold it · required by {cert.roleCount}
										{cert.roleCount === 1 ? 'role' : 'roles'}
									</div>
									<div class="mt-2 flex flex-wrap gap-1">
										<Action
											action={updateCertification.for(cert.id)}
											label="Edit"
											iconOnly
											icon={pencilIcon}
											variant="ghost"
											size="xs"
											modalTitle="Edit {cert.name}"
											successToast="Clearance updated"
										>
											{#snippet form()}
												<input type="hidden" name="id" value={cert.id} />
												<FormField name="name" label="Name" type="text" value={cert.name} />
												<FormField
													name="description"
													label="What it covers"
													type="textarea"
													value={cert.description ?? ''}
													maxlength={CERT_DESCRIPTION_MAX}
												/>
												<FormField
													name="issuedBy"
													label="Issued by"
													type="text"
													value={cert.issuedBy ?? ''}
													description="Leave blank for something CMC signs off itself."
												/>
												<FormField
													name="validityMonths"
													label="Valid for (months)"
													type="number"
													min="1"
													value={cert.validityMonths ? String(cert.validityMonths) : ''}
													description="Blank means it never lapses. Changing this applies to future grants only — the {cert.holderCount} already issued keep the expiry they were stamped with."
												/>
												<FormField
													name="displayOrder"
													label="Display order"
													type="number"
													value={String(cert.displayOrder)}
												/>
											{/snippet}
										</Action>

										{#if cert.isActive}
											<Action
												action={archiveCertification.for(cert.id)}
												label="Archive"
												iconOnly
												icon={archiveIcon}
												variant="ghost"
												size="xs"
												modalTitle="Archive {cert.name}?"
												submitLabel="Archive"
												successToast="Clearance archived"
											>
												{#snippet form()}
													<input type="hidden" name="id" value={cert.id} />
													<p class="text-sm">
														It disappears from the grant form. Everyone who holds it keeps it, and
														roles that require it still require it.
													</p>
												{/snippet}
											</Action>
										{:else}
											<Action
												action={restoreCertification.for(cert.id)}
												label="Restore"
												iconOnly
												icon={unarchiveIcon}
												variant="ghost"
												size="xs"
												modalTitle="Restore {cert.name}?"
												submitLabel="Restore"
												successToast="Clearance restored"
											>
												{#snippet form()}
													<input type="hidden" name="id" value={cert.id} />
													<p class="text-sm">Staff will be able to grant this again.</p>
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
												label="Delete"
												iconOnly
												icon={trashIcon}
												variant="ghost"
												size="xs"
												class="text-error"
												modalTitle="Delete {cert.name}?"
												submitLabel="Delete"
												submitVariant="error"
												successToast="Clearance deleted"
											>
												{#snippet form()}
													<input type="hidden" name="id" value={cert.id} />
													<p class="text-sm">Nobody holds this, so it can be removed outright.</p>
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
											{cert.lapsingBeforeShift}
											{cert.lapsingBeforeShift === 1 ? 'lapses' : 'lapse'} before a booked shift →
										</a>
									{/if}
								</li>
							{/each}
						</ul>
						<p class="mt-3 text-subtle text-xs">
							Grants are made on a person's record. A renewal is a new row, never an edit — which is
							what keeps "was their card current on the night?" answerable.
						</p>
					{/if}
				</InfoCard>

				<Button href={resolve('/staff/volunteer/people?tab=cleared')} variant="ghost" size="sm">
					See who's cleared →
				</Button>
			</div>
		</div>
	{/await}
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
