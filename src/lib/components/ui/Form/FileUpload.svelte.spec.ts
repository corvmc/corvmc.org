import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FileUpload from './FileUpload.svelte';

/** Put files on the picker the way a user's choice does, then fire `change`. */
function pick(input: HTMLInputElement, files: File[]) {
	const transfer = new DataTransfer();
	for (const f of files) transfer.items.add(f);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

describe('FileUpload (immediate)', () => {
	it('hands every picked file to uploadAll in one call', async () => {
		const uploadAll = vi.fn(async () => {});
		const { container } = await render(FileUpload, { uploadAll, showPreview: false });

		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		expect(input.multiple).toBe(true);
		pick(input, [pdf('a.pdf'), pdf('b.pdf')]);

		await vi.waitFor(() => expect(uploadAll).toHaveBeenCalledTimes(1));
		expect((uploadAll.mock.calls[0] as unknown as [File[]])[0]).toHaveLength(2);
	});

	// Endpoint uploads (riders, receipts) have no key to submit, so nothing
	// should be posted with an enclosing form under an empty name.
	it('renders no hidden input without a name', async () => {
		const { container } = await render(FileUpload, { upload: async () => {} });
		expect(container.querySelector('input[type="hidden"]')).toBeNull();
	});

	it('clears the picker after an upload, so the same file can be picked again', async () => {
		const upload = vi.fn(async () => {});
		const { container } = await render(FileUpload, { upload, showPreview: false });

		pick(container.querySelector('input[type="file"]') as HTMLInputElement, [pdf('a.pdf')]);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect((container.querySelector('input[type="file"]') as HTMLInputElement).value).toBe('')
		);
	});
});
