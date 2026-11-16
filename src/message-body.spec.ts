import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A message body is user text, and the class of bug is user text rendered as
 * HTML. `MessageBody.svelte` is the one place that does it, through
 * `renderMessageMarkdown`; this walks every component and holds that line.
 */

const ROOT = join(import.meta.dirname, '..');
const MESSAGE_BODY = 'src/lib/components/inbox/MessageBody.svelte';

// Other `{@html}` sites whose expression names a body. Each is sanitized
// before it gets here, and none of them is a chat or inbox message.
const OTHER_SANITIZED_BODIES: Record<string, string> = {
	'src/lib/components/groups/AnnouncementList.svelte': 'post.bodyHtml',
	'src/routes/staff/marketing/campaigns/[id]/+page.svelte': 'sanitizeHtml(campaign.htmlBody)'
};

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

const files = svelteFiles(join(ROOT, 'src')).map((path) => ({
	file: relative(ROOT, path),
	source: readFileSync(path, 'utf8')
}));

const atHtml = (source: string) =>
	[...source.matchAll(/\{@html\s+([\s\S]*?)\}\s*(?:<|$)/g)].map((m) => m[1].trim());

describe('message bodies render only through MessageBody', () => {
	it('every {@html} of a body is MessageBody or a listed sanitized site', () => {
		const offenders = files.flatMap(({ file, source }) =>
			atHtml(source)
				.filter((expr) => /body/i.test(expr))
				.filter((expr) =>
					file === MESSAGE_BODY
						? expr !== 'renderMessageMarkdown(body)'
						: OTHER_SANITIZED_BODIES[file] !== expr
				)
				.map((expr) => `${file}: {@html ${expr}}`)
		);
		expect(offenders).toEqual([]);
	});

	it('no other component calls renderMessageMarkdown', () => {
		const callers = files
			.filter(({ source }) => source.includes('renderMessageMarkdown'))
			.map(({ file }) => file);
		expect(callers).toEqual([MESSAGE_BODY]);
	});

	it('no inbox component prints a message body itself', () => {
		// `note.body` is a staff note, which is plain text by design.
		const inbox = files.filter(
			({ file }) =>
				file !== MESSAGE_BODY &&
				(file.startsWith('src/lib/components/inbox/') ||
					/^src\/routes\/.*\/(messages|inbox)\//.test(file))
		);
		const offenders = inbox.flatMap(({ file, source }) =>
			[...source.matchAll(/(?<!=)\{\s*(\w+)\.body\s*\}/g)]
				.filter((m) => m[1] !== 'note')
				.map((m) => `${file}: ${m[0]}`)
		);
		expect(offenders).toEqual([]);
	});
});
