<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { getBandRiderPage } from '$lib/remote/rider.remote';
	import {
		riderElementKindLabels,
		riderInputSourceLabels,
		riderMonitorFormatLabels,
		riderStandTypeLabels
	} from '$lib/config';
	import { getBandLayoutContext } from '../../layout-context';
	import { resolve } from '$app/paths';

	/**
	 * The input list, as a thing you hand somebody.
	 *
	 * A print page rather than a PDF, following the EPK page next door: a print
	 * stylesheet is the app's answer to "make me a document" and
	 * `reporting-spec.md` says so outright — Cloudflare Browser Rendering is the
	 * escape hatch if a real PDF is ever needed, and it is not needed for one
	 * table.
	 *
	 * Deliberately not the editor. The editor is a page for a member filling in
	 * their own corner; this is the page an engineer reads, so it is numbered,
	 * banded in eights, ordered the way a console is, and has no controls at all.
	 *
	 * Same query as the editor, so opening this costs nothing extra and the two
	 * can never disagree about what the rider says.
	 */
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	const data = $derived(await getBandRiderPage(layout.band.id));
	const rider = $derived(data.rider);

	/** Every channel, in order, already numbered by the service. */
	const channels = $derived(
		rider.elements.flatMap((el) =>
			el.inputs.map((input) => ({
				...input,
				elementLabel: el.label,
				ownerName: el.ownerName
			}))
		)
	);

	/**
	 * Banks of eight, because that is how a console is laid out and how the
	 * engineer reading this will patch it. A rule every input-list guide gives
	 * and the one piece of formatting that is not decoration.
	 */
	const banks = $derived(
		Array.from({ length: Math.ceil(channels.length / 8) }, (_, i) =>
			channels.slice(i * 8, i * 8 + 8)
		)
	);

	const monitors = $derived(rider.elements.filter((el) => el.kind === 'monitor'));
	const fromVenue = $derived(rider.elements.filter((el) => el.providedBy === 'venue'));
	const contactName = $derived(
		data.roster.find((m) => m.userId === rider.techContactUserId)?.name ?? null
	);

	const overCapacity = $derived(
		data.consoleChannels > 0 && rider.channelCount > data.consoleChannels
	);

	const mixName = (userId: string | null) =>
		userId ? (data.roster.find((m) => m.userId === userId)?.name ?? 'Someone') : null;

	const exportHref = $derived(resolve('/band/[slug]/rider/export', { slug: layout.band.slug }));
</script>

<svelte:head>
	<title>Input list — {layout.band.name}</title>
	<style>
		@media print {
			.no-print {
				display: none !important;
			}
			body {
				font-size: 10pt;
			}
			.rider-page {
				padding: 0;
				max-width: 100%;
			}
			a {
				color: inherit;
				text-decoration: none;
			}
			/* A bank is the unit an engineer reads; splitting one across a page
			   break is the one thing this layout must not do. */
			.bank {
				break-inside: avoid;
			}
		}
	</style>
</svelte:head>

<div class="no-print fixed top-4 right-4 z-50 flex gap-2">
	<Button variant="primary" size="sm" onclick={() => window.print()}>Print</Button>
	<Button href={exportHref} variant="ghost" size="sm" data-sveltekit-reload>Download CSV</Button>
	<Button
		href={resolve('/band/[slug]/rider', { slug: layout.band.slug })}
		variant="ghost"
		size="sm"
	>
		&larr; Edit
	</Button>
</div>

<div class="rider-page mx-auto max-w-3xl">
	<header class="mb-6 border-b-2 border-gray-200 pb-4">
		<h1 class="text-3xl font-bold">{layout.band.name}</h1>
		<p class="text-sm text-gray-600">Input list &amp; technical requirements</p>
		<dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-gray-500">Channels</dt>
				<dd class="font-semibold">{rider.channelCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Need +48V</dt>
				<dd class="font-semibold">{rider.phantomCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Monitor mixes</dt>
				<dd class="font-semibold">{rider.monitorMixCount}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Monitors</dt>
				<dd class="font-semibold">
					{rider.monitorFormat ? riderMonitorFormatLabels[rider.monitorFormat] : 'No preference'}
				</dd>
			</div>
		</dl>
		{#if contactName}
			<p class="mt-2 text-sm"><span class="text-gray-500">Tech contact:</span> {contactName}</p>
		{/if}
	</header>

	{#if overCapacity}
		<!--
			The half of the Production user story that had no design anywhere: "flag
			what the room cannot do". It is a note to the band rather than a refusal
			— plenty of rooms sub-mix a kit, and the house engineer is the one who
			decides how.
		-->
		<p class="over-capacity mb-6">
			This asks for <strong>{rider.channelCount}</strong> channels and the room's desk takes
			<strong>{data.consoleChannels}</strong>. Nothing is wrong with the rider — but the house
			engineer will be combining or dropping inputs, and it is worth agreeing which ones before
			load-in rather than at it.
		</p>
	{/if}

	{#if channels.length === 0}
		<p class="mb-8 text-sm text-gray-600">
			No channels listed yet. Anyone in the band can add theirs from the rider page.
		</p>
	{/if}

	{#each banks as bank, i (i)}
		<section class="bank mb-6">
			{#if banks.length > 1}
				<h2 class="section-label">Channels {i * 8 + 1}–{i * 8 + bank.length}</h2>
			{/if}
			<table class="w-full text-sm">
				<thead>
					<tr class="head-row">
						<th class="w-8 py-1">#</th>
						<th class="py-1">Source</th>
						<th class="py-1">Via</th>
						<th class="py-1">Mic / DI</th>
						<th class="py-1">Stand</th>
						<th class="w-12 py-1">48V</th>
						<th class="py-1">Monitor</th>
					</tr>
				</thead>
				<tbody>
					{#each bank as channel (channel.id)}
						<tr class="border-b border-gray-100 align-top">
							<td class="py-1 font-mono">{channel.channel}</td>
							<td class="py-1">
								<span class="font-medium">{channel.label}</span>
								<span class="block text-xs text-gray-500">
									{channel.elementLabel}{channel.ownerName ? ` · ${channel.ownerName}` : ''}
								</span>
							</td>
							<td class="py-1">{riderInputSourceLabels[channel.source]}</td>
							<td class="py-1">{channel.micPref ?? '—'}</td>
							<td class="py-1">{riderStandTypeLabels[channel.stand]}</td>
							<td class="py-1">{channel.phantom ? '✓' : ''}</td>
							<td class="py-1">{mixName(channel.monitorMixUserId) ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	{#if monitors.length}
		<section class="mb-6">
			<h2 class="section-label">Monitors</h2>
			<ul class="text-sm">
				{#each monitors as wedge (wedge.id)}
					<li class="border-b border-gray-100 py-1">
						{wedge.label}{wedge.ownerName ? ` — ${wedge.ownerName}` : ''}
						{#if wedge.notes}<span class="text-gray-500"> · {wedge.notes}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if fromVenue.length}
		<section class="mb-6">
			<h2 class="section-label">Needed from the venue</h2>
			<ul class="text-sm">
				{#each fromVenue as item (item.id)}
					<li class="border-b border-gray-100 py-1">
						{item.label}
						<span class="text-gray-500">· {riderElementKindLabels[item.kind]}</span>
						{#if item.notes}<span class="text-gray-500"> · {item.notes}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if rider.notes}
		<section class="mb-6">
			<h2 class="section-label">Notes</h2>
			<p class="text-sm whitespace-pre-line">{rider.notes}</p>
		</section>
	{/if}

	{#if data.uploads.length}
		<section>
			<h2 class="section-label">Supplied by the band</h2>
			<ul class="text-sm">
				{#each data.uploads as file (file.attachmentId)}
					<li class="py-1">
						{file.slot === 'stage_plot' ? 'Stage plot' : 'Tech rider'}: {file.filename ?? 'file'}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<!--
	A print document, so the page paints its own light ground rather than
	inheriting the panel theme — the same choice the EPK print page makes, and
	the reason these are rules rather than a class list on every heading.
-->
<style>
	.rider-page {
		min-height: 100vh;
		padding: 3rem 2rem;
		background: #fff;
		color: #111827;
	}

	.section-label {
		margin-bottom: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
	}

	.head-row {
		border-bottom: 1px solid #d1d5db;
		text-align: left;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: #6b7280;
	}

	.over-capacity {
		border-left: 4px solid #f59e0b;
		background: #fffbeb;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
	}
</style>
