<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import { CERT_EXPIRY_WARNING_DAYS } from '$lib/config';
	import { getClearances, getActiveCertifications } from '$lib/remote/volunteer.remote';

	type StateView = 'current' | 'expiring' | 'expired' | 'revoked' | 'all';
	const stateViews: StateView[] = ['current', 'expiring', 'expired', 'revoked', 'all'];

	const initial = page.url.searchParams;
	const parseState = (raw: string | null): StateView =>
		stateViews.includes(raw as StateView) ? (raw as StateView) : 'current';

	let stateView = $state(parseState(initial.get('state')));
	let certFilter = $state(initial.get('cert') ?? '');

	$effect(() => {
		const pairs: [string, string][] = [];
		if (stateView !== 'current') pairs.push(['state', stateView]);
		if (certFilter) pairs.push(['cert', certFilter]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/clearances')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	let rows = $derived(
		getClearances({
			certificationId: certFilter || undefined,
			state: stateView === 'all' ? undefined : stateView
		})
	);
	let certifications = $derived(getActiveCertifications());

	// Every row is the newest grant for that member+certification, so the counts
	// answer "how many people are cleared", not "how many pieces of paper exist".
	let allRows = $derived(getClearances({ certificationId: certFilter || undefined }));

	const stateLabels: Record<Exclude<StateView, 'all'>, string> = {
		current: 'Current',
		expiring: `Expiring (${CERT_EXPIRY_WARNING_DAYS}d)`,
		expired: 'Lapsed',
		revoked: 'Revoked'
	};

	const badgeClass: Record<string, string> = {
		current: 'badge-success',
		expiring: 'badge-warning',
		expired: 'badge-error',
		revoked: 'badge-neutral'
	};
</script>

<PageHeader title="Who's Cleared" subtitle="Staff" backHref="/staff/volunteer/certifications" />

<PageContent>
	{#await allRows then all}
		<TabBar
			class="mb-4"
			collapse
			tabs={[
				{
					key: 'current',
					label: stateLabels.current,
					badge: all.filter((r) => r.state === 'current').length
				},
				{
					key: 'expiring',
					label: stateLabels.expiring,
					badge: all.filter((r) => r.state === 'expiring').length
				},
				{
					key: 'expired',
					label: stateLabels.expired,
					badge: all.filter((r) => r.state === 'expired').length
				},
				{
					key: 'revoked',
					label: stateLabels.revoked,
					badge: all.filter((r) => r.state === 'revoked').length
				},
				{ key: 'all', label: 'All', badge: all.length }
			]}
			active={stateView}
			onchange={(key) => (stateView = key as StateView)}
		/>
	{/await}

	<FilterBar activeCount={certFilter ? 1 : 0} onclear={() => (certFilter = '')}>
		{#await certifications then certs}
			<Select
				size="sm"
				aria-label="Certification"
				value={certFilter}
				onchange={(e: Event) => {
					certFilter = (e.currentTarget as HTMLSelectElement).value;
				}}
			>
				<option value="">All certifications</option>
				{#each certs as cert (cert.id)}
					<option value={cert.id}>{cert.name}</option>
				{/each}
			</Select>
		{/await}
	</FilterBar>

	{#await rows then clearances}
		{#if clearances.length === 0}
			<EmptyState
				title="Nobody here"
				description={stateView === 'expiring'
					? 'Nothing lapses in the next two months.'
					: 'No records match this view.'}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">State</span></th>
					<th>Member</th>
					<th class="col-support">Certification</th>
					<th class="col-support whitespace-nowrap">Granted</th>
					<th class="col-extra whitespace-nowrap">Expires</th>
				{/snippet}

				{#each clearances as row (row.userId + row.certificationId)}
					<tr class="hover">
						<td class="w-px">
							<span class="badge badge-sm {badgeClass[row.state]}">{row.state}</span>
						</td>
						<td class="whitespace-nowrap">
							<EntityIdentity ref={row.member} />
						</td>
						<td class="col-support cell-primary">{row.certificationName}</td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(row.grantedAt)}</td>
						<td class="col-extra whitespace-nowrap">
							{row.expiresAt ? formatDateShortYear(row.expiresAt) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/await}
</PageContent>
