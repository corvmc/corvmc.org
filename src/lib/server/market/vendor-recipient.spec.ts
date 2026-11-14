import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from '../../../../scripts/lib/source-files';

/**
 * Mail to a vendor goes through `vendor-recipient.ts` (#2830). A market sender
 * that queues or resends a message without `addressVendorThread` mails
 * whatever address the application left on the thread, and a market module that
 * reads the thread's address itself bypasses the organization's contact.
 */
const SENDS = /\b(queuedReplyStatements|addOutboundMessage|retryNow|queueEmails?|outboxRow)\(/g;
const RESOLVER = 'src/lib/server/market/vendor-recipient.ts';

const files = sourceFiles(
	['src/lib/server/market/**/*.ts', 'src/lib/remote/market.remote.ts'],
	new Set([RESOLVER])
).filter((f) => !f.endsWith('.spec.ts'));

/** The text from the enclosing function's start up to `index`. */
function functionBefore(source: string, index: number): string {
	const head = source.slice(0, index);
	const start = Math.max(
		head.lastIndexOf('\nexport async function '),
		head.lastIndexOf('\nasync function '),
		head.lastIndexOf('\nexport function '),
		head.lastIndexOf('\nfunction ')
	);
	return head.slice(start);
}

describe('market mail senders', () => {
	it('are found, so an empty pass means something', () => {
		const senders = files.filter((f) => new RegExp(SENDS.source).test(readFileSync(f, 'utf8')));
		expect(senders).toContain('src/lib/server/market/market-service.ts');
	});

	it.each(files)('%s addresses the vendor before each send', (file) => {
		const source = readFileSync(file, 'utf8');
		const unaddressed = [...source.matchAll(SENDS)]
			.filter((m) => !functionBefore(source, m.index).includes('addressVendorThread('))
			.map((m) => `${m[1]} at line ${source.slice(0, m.index).split('\n').length}`);
		expect(unaddressed).toEqual([]);
	});

	it.each(files)('%s reads no address off the inbox thread', (file) => {
		expect(readFileSync(file, 'utf8')).not.toMatch(/inboxThread\.contact(Email|Name|Phone)/);
	});
});
