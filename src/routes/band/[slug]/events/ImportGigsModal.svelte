<script lang="ts">
	import Modal from '$lib/components/shared/Modal.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { importGigsForm } from '$lib/remote/band-events.remote';
	import { parseGigImport, GIG_IMPORT_MAX_LINES } from '$lib/utils/gig-import';
	import { invalidateAll } from '$app/navigation';

	// No band prop: `importGigsForm` resolves the band from the route guard, and
	// the `slug` field it used to carry was never read by the handler.
	let { open = $bindable(false) }: { open?: boolean } = $props();

	const fields = importGigsForm.fields;

	let text = $state('');

	// Previewed with the same parser the server uses, so what's shown here is
	// exactly what gets written — no second set of rules to drift apart.
	const preview = $derived(text.trim() ? parseGigImport(text) : { rows: [], errors: [] });
</script>

<Modal bind:open title="Import past gigs" maxWidth="max-w-2xl">
	<Form
		remote={importGigsForm}
		successToast="Gigs imported"
		onsuccess={() => {
			open = false;
			text = '';
			invalidateAll();
		}}
		class="space-y-4"
	>
		<FormField name="text" label="One gig per line">
			<textarea
				{...fields.text.as('text')}
				bind:value={text}
				class="textarea w-full font-mono text-xs"
				rows="10"
				placeholder="2024-03-14 | Bombs Away Cafe | w/ Paper Wolves&#10;2023-11-02 | The Majestic Theatre"
			></textarea>
		</FormField>

		<p class="text-subtle">
			<code>date | venue | title | ticket link</code> — only the date is required. Start a title
			with
			<code>w/</code> to list the other acts. Gigs must be in the past, {GIG_IMPORT_MAX_LINES} at a time.
			Imported gigs are published with no end time.
		</p>

		{#if preview.errors.length > 0}
			<div class="rounded border border-error/40 bg-error/10 p-3">
				<p class="text-sm font-medium">These lines will be skipped:</p>
				<ul class="mt-1 space-y-0.5 text-xs">
					{#each preview.errors as err (err.line)}
						<li>Line {err.line}: {err.message}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if preview.rows.length > 0}
			<div class="overflow-x-auto rounded border border-base-300">
				<table class="table table-xs">
					<thead>
						<tr><th>Date</th><th>Title</th><th>Venue</th><th>With</th></tr>
					</thead>
					<tbody>
						{#each preview.rows as row (row.line)}
							<tr>
								<td class="tabular-nums">{row.date}</td>
								<td>{row.title}</td>
								<td class="opacity-70">{row.location ?? '—'}</td>
								<td class="opacity-70">{row.support.join(', ') || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="flex justify-end gap-2">
			<SubmitButton
				label={preview.rows.length > 0 ? `Import ${preview.rows.length} gigs` : 'Import'}
				variant="primary"
				disabled={preview.rows.length === 0}
			/>
		</div>
	</Form>
</Modal>
