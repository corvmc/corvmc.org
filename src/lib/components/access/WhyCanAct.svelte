<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Why a person can act (#2994): each position, committee seat and live shift
	 * role. A position shows its one-line description; the capability lists come
	 * from the functions the guards ask, and only `showPermissions` (the staff
	 * person page) renders them, folded (#3241).
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { positionDescriptions, positionLabels } from '#lib/config.js';
	import { capabilityLabel } from '#lib/capability-label.js';
	import type { getPersonAccessWhy } from '#lib/remote/why-can-act.remote.js';

	let {
		why,
		showPermissions = false
	}: {
		why: Awaited<ReturnType<typeof getPersonAccessWhy>>;
		showPermissions?: boolean;
	} = $props();

	const empty = $derived(
		why.positions.length === 0 && why.departments.length === 0 && why.shiftRoles.length === 0
	);
</script>

{#snippet permissions(labels: string[])}
	<details class="text-sm" data-testid="why-permissions">
		<summary class="cursor-pointer text-muted">{m.access_why_show_permissions_label()}</summary>
		<ul class="mt-1 text-muted">
			{#each labels as label, i (i)}
				<li>{label}</li>
			{/each}
		</ul>
	</details>
{/snippet}

{#if empty}
	<EmptyState title={m.access_why_none_title()} description={m.access_why_none_body()} />
{/if}

{#if why.positions.length > 0}
	<InfoCard title={m.access_why_positions_title()} state={why.positions.length}>
		<ul class="flex flex-col gap-3" data-testid="why-positions">
			{#each why.positions as p (p.position)}
				<li>
					<div class="font-medium">{positionLabels[p.position]}</div>
					<p class="text-muted text-sm">{positionDescriptions[p.position]}</p>
					{#if showPermissions}
						{@render permissions(p.capabilities.map((cap) => capabilityLabel(cap)))}
					{/if}
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

{#if why.departments.length > 0}
	<InfoCard title={m.access_why_committees_title()} state={why.departments.length}>
		<ul class="flex flex-col gap-3" data-testid="why-committees">
			{#each why.departments as d (d.groupId)}
				<li>
					<div class="font-medium">{d.name}</div>
					<div class="text-sm">
						{d.positions.length > 0 ? d.positions.join(', ') : m.access_why_member_text()}
					</div>
					<!-- Where its own-records grants reach: named on a project, or owning a task in it (#2959). -->
					{#if showPermissions && d.projects.length > 0 && d.grants.some((g) => g.reach === 'owned')}
						<div class="text-sm" data-testid="why-projects">
							{m.access_why_on_projects_text({
								projects: d.projects
									.map((p) =>
										p.via === 'deliverable'
											? m.access_why_project_by_task_text({ name: p.name })
											: p.name
									)
									.join(', ')
							})}
						</div>
					{/if}
					{#if showPermissions}
						{@render permissions([
							m.access_why_tasks_text(),
							...d.grants.map((g) =>
								g.reach === 'owned'
									? m.access_why_owned_text({ label: capabilityLabel(g.capability) })
									: capabilityLabel(g.capability)
							)
						])}
					{/if}
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

{#if why.shiftRoles.length > 0}
	<InfoCard title={m.access_why_shift_roles_title()} state={why.shiftRoles.length}>
		<ul class="flex flex-col gap-3" data-testid="why-shift-roles">
			{#each why.shiftRoles as r (`${r.roleName}:${r.eventId}`)}
				<li>
					<div class="font-medium">{r.roleName}</div>
					<div class="text-sm">{r.eventTitle}</div>
					{#if showPermissions}
						{@render permissions(r.capabilities.map((cap) => capabilityLabel(cap)))}
					{/if}
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
