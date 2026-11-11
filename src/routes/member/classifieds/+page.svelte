<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page as pageState } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { formatDate, relativeDay } from '#lib/utils/format.js';
	import {
		classifiedKinds,
		classifiedCategories,
		classifiedTagKinds,
		classifiedKindLabels,
		classifiedKindLabel,
		CLASSIFIED_GEAR_DISCLAIMER,
		classifiedCategoryLabels,
		type ClassifiedKind,
		type ClassifiedCategory,
		type ClassifiedTagKind
	} from '#lib/config.js';
	import { getClassifiedBoard } from '#lib/remote/classifieds.remote.js';
	import CreateClassifiedAction from './CreateClassifiedAction.svelte';

	type TabKey = 'board' | 'mine';
	let tab = $state<TabKey>('board');
	let searchText = $state('');
	let searchDebounced = $state('');
	let kindFilter = $state('');
	let categoryFilter = $state('');
	let page = $state(1);

	// A tag chip on a post links here with the tag in the query string.
	function initialTagKind(): ClassifiedTagKind | '' {
		const raw = pageState.url.searchParams.get('tagKind') ?? '';
		return (classifiedTagKinds as readonly string[]).includes(raw)
			? (raw as ClassifiedTagKind)
			: '';
	}
	let tagKind = $state(initialTagKind());
	let tagValue = $state(pageState.url.searchParams.get('tagValue') ?? '');

	const result = $derived(
		getClassifiedBoard({
			kind: (kindFilter || undefined) as ClassifiedKind | undefined,
			category: (categoryFilter || undefined) as ClassifiedCategory | undefined,
			tagKind: tagKind && tagValue ? tagKind : undefined,
			tagValue: tagKind && tagValue ? tagValue : undefined,
			search: searchDebounced || undefined,
			mine: tab === 'mine' || undefined,
			page
		})
	);

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (kindFilter ? 1 : 0) + (categoryFilter ? 1 : 0) + (tagValue ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		kindFilter = '';
		categoryFilter = '';
		tagKind = '';
		tagValue = '';
		page = 1;
	}
</script>

<PageHeader title={m.member_classifieds_title()} subtitle={m.member_community_body()}>
	<CreateClassifiedAction />
</PageHeader>

<PageContent>
	<TabBar
		tabs={[
			{ key: 'board', label: m.member_classifieds_board_label() },
			{ key: 'mine', label: m.member_classifieds_posts_label() }
		]}
		active={tab}
		onchange={(k) => {
			tab = k as TabKey;
			page = 1;
		}}
	/>

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.member_classifieds_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.member_classifieds_post_type_label()}
			value={kindFilter}
			onchange={(e: Event) => {
				kindFilter = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.member_classifieds_any_type_label()}</option>
			{#each classifiedKinds as k (k)}
				<option value={k}>{classifiedKindLabels[k]}</option>
			{/each}
		</Select>
		<Select
			size="sm"
			aria-label={m.member_category_label()}
			value={categoryFilter}
			onchange={(e: Event) => {
				categoryFilter = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.member_all_categories_label()}</option>
			{#each classifiedCategories as c (c)}
				<option value={c}>{classifiedCategoryLabels[c]}</option>
			{/each}
		</Select>
		{#if tagValue}
			<Badge size="sm" variant="outline">{m.member_classifieds_tagged_label({ tagValue })}</Badge>
		{/if}
	</FilterBar>

	{#if categoryFilter === 'gear'}
		<Alert type="warning">{CLASSIFIED_GEAR_DISCLAIMER}</Alert>
	{/if}

	<DataList
		{result}
		empty={tab === 'mine'
			? m.member_classifieds_have_not_posted_anything_yet_body()
			: m.member_classifieds_nothing_board_right_now_body()}
		onpage={(p) => (page = p)}
	>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.member_status_label()}</span></th>
					<th>{m.member_classifieds_post_label()}</th>
					<th>{m.member_classifieds_posted_by_label()}</th>
					<th class="col-support">{m.member_tags_label()}</th>
					<th class="col-extra whitespace-nowrap"
						>{tab === 'mine'
							? m.member_classifieds_expires_label()
							: m.member_classifieds_posted_label()}</th
					>
				{/snippet}
				{#each rows as r (r.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`member/classifieds/${r.id}`)}>
						<td class="w-px"><StatusBadge status={r.displayStatus} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={r.ref}>
								{#snippet subtitle()}
									{classifiedKindLabel(r.kind, r.category)} · {classifiedCategoryLabels[r.category]}
								{/snippet}
							</EntityIdentity>
						</td>
						<td class="min-w-0"><EntityChip ref={r.band ?? r.author} icon={false} /></td>
						<td class="col-support">
							<span class="flex flex-wrap gap-1">
								{#each r.tags.slice(0, 3) as t (`${t.kind}:${t.value}`)}
									<Badge size="xs" variant="ghost">{t.value}</Badge>
								{/each}
							</span>
						</td>
						<td class="col-extra whitespace-nowrap">
							{tab === 'mine' ? formatDate(r.expiresAt) : relativeDay(r.createdAt)}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
