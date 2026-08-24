<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import {
		VOLUNTEER_ROLE_DESCRIPTION_MAX,
		volunteerRoleGroups,
		volunteerRoleGroupLabels
	} from '$lib/config';
	import { getVolunteerRoles, createVolunteerRole } from '$lib/remote/volunteer.remote';

	let roles = $derived(getVolunteerRoles());

	const groupOptions = volunteerRoleGroups.map((g) => ({
		value: g,
		label: volunteerRoleGroupLabels[g]
	}));

	const descriptionHelp =
		'Markdown. This is what members read on their volunteering page, so say what the job actually involves.';

	// Retired roles are off by default. They stay listed for staff — the work done
	// under them still resolves everywhere — but a coordinator filling next week's
	// shifts is reading the live list, and last year's roles only pad it.
	let showRetired = $state(page.url.searchParams.get('retired') === '1');

	// `goto(..., { replaceState })`, not `replaceState()`: the latter only rewrites
	// the address bar and the router overwrites that entry on the next navigation.
	$effect(() => {
		const href = `${resolve('/staff/volunteer/roles')}${showRetired ? '?retired=1' : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	type Role = Awaited<ReturnType<typeof getVolunteerRoles>>[number];

	// Group order comes from the enum, not from the data, so the sections stay put
	// as roles are added. Empty groups drop out rather than rendering a bare
	// heading — the same call InterestFields makes on the member side.
	function groupedRoles(all: Role[]) {
		const visible = all.filter((r) => showRetired || r.isActive);
		return volunteerRoleGroups
			.map((key) => ({ key, roles: visible.filter((r) => r.group === key) }))
			.filter((g) => g.roles.length > 0);
	}
</script>

<PageHeader title="Volunteer Roles" subtitle="Staff" backHref="/staff/volunteer">
	<Action
		action={createVolunteerRole}
		label="New Role"
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
</PageHeader>

<PageContent width="3xl">
	<FilterBar activeCount={showRetired ? 1 : 0} onclear={() => (showRetired = false)}>
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={showRetired}
				onchange={(e) => (showRetired = e.currentTarget.checked)}
			/>
			Include retired
		</label>
	</FilterBar>

	{#await roles then rows}
		{@const groups = groupedRoles(rows)}
		{#if groups.length === 0}
			{#if rows.length === 0}
				<EmptyState
					title="No volunteer roles yet"
					description="Add a role and members can start logging hours against it."
				/>
			{:else}
				<EmptyState
					title="Every role is retired"
					description="Tick “Include retired” to see them."
				/>
			{/if}
		{:else}
			{#each groups as group (group.key)}
				<InfoCard title={volunteerRoleGroupLabels[group.key]}>
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">Status</span></th>
							<th>Role</th>
							<th class="cell-num whitespace-nowrap">Unfilled</th>
							<th class="col-support cell-num">Interested</th>
							<th class="col-support cell-num">Logs</th>
							<th class="col-extra cell-num">Order</th>
						{/snippet}

						{#each group.roles as role (role.id)}
							{@const href = resolve(`/staff/volunteer/roles/${role.id}`)}
							<tr class="hover cursor-pointer" use:rowLink={href}>
								<td class="w-px">
									<StatusBadge status={role.isActive ? 'active' : 'retired'} />
								</td>

								<td class="cell-primary">
									<a {href} class="truncate font-medium">{role.name}</a>
									{#if role.description}
										<div class="truncate text-subtle" title={role.description}>
											{role.description}
										</div>
									{/if}
									{#if role.requiredCertifications.length > 0}
										<div class="mt-1 flex flex-wrap gap-1">
											{#each role.requiredCertifications as cert (cert.id)}
												<span class="badge badge-ghost badge-xs">{cert.name}</span>
											{/each}
										</div>
									{/if}
								</td>

								<!--
									An em dash at zero, not "0": the point of the column is that a
									short-staffed role is the only thing on the page drawing the eye.
								-->
								<td class="cell-num whitespace-nowrap">
									{#if role.unfilled > 0}
										<span class="badge badge-warning badge-sm">{role.unfilled}</span>
									{:else}
										<span class="opacity-40">—</span>
									{/if}
								</td>

								<td class="col-support cell-num">{role.interested}</td>
								<td class="col-support cell-num">{role.logCount}</td>
								<td class="col-extra cell-num">{role.displayOrder}</td>
							</tr>
						{/each}
					</Table>
				</InfoCard>
			{/each}
		{/if}
	{/await}
</PageContent>
