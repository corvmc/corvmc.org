<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Every address on a roster to the clipboard, comma-separated and deduplicated. */
	import { toast } from 'svelte-sonner';
	import { IconCopy } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { uniqueEmails } from '#lib/utils/unique-emails.js';

	let {
		emails
	}: {
		/** The addresses themselves, or a fetch of every match rather than one page's. */
		emails: (string | null)[] | (() => Promise<string[]>);
	} = $props();

	let copying = $state(false);
	async function copy() {
		copying = true;
		try {
			const list = uniqueEmails(typeof emails === 'function' ? await emails() : emails);
			if (list.length === 0) {
				toast.info(m.roster_copy_emails_button_no_email_addresses_toast());
				return;
			}
			await navigator.clipboard.writeText(list.join(', '));
			toast.success(
				m.roster_copy_emails_button_copied_toast({
					length: list.length,
					value: list.length === 1 ? 'address' : 'addresses'
				})
			);
		} catch {
			toast.error(m.roster_copy_emails_button_couldn_t_copy_toast());
		} finally {
			copying = false;
		}
	}
</script>

<Button variant="ghost" size="sm" onclick={copy} disabled={copying}>
	<IconCopy size={16} />
	{m.roster_copy_emails_button_copy_emails_label()}
</Button>
