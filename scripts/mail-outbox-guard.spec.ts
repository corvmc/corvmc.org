import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Mail goes through the outbox (docs/architecture/outbox.md): a row written with
 * the save, sent and retried by `deliverOutbox`. A direct Postmark send throws
 * into the request that saved, or is lost in `afterResponse`, with no record.
 * This refuses a value import of the Postmark SDK or of any send function from
 * the client, by name, so a barrel re-export cannot route around it.
 */
const SEND_FUNCTIONS = [
	'sendEmailWithTemplate',
	'sendTemplateBatch',
	'sendBroadcastBatch',
	'sendInboxReply',
	'sendTemplatedEmails'
];

/** The client, its barrel and the outbox: where sending is the job. */
const SENDERS = new Set([
	'src/lib/server/notification/email/postmark-client.ts',
	'src/lib/server/notification/email/index.ts',
	'src/lib/server/outbox/outbox-service.ts'
]);

/**
 * Senders not yet moved to the outbox. A path list that only shrinks: moving
 * one deletes its line, and adding one needs a reason in review. #2839 tracks it.
 */
const NOT_YET_ON_THE_OUTBOX = new Set([
	'src/lib/server/marketing/campaign-service.ts',
	'src/lib/server/group/announcement-fanout.ts',
	'src/lib/server/ballot/ballot-fanout.ts',
	'src/lib/server/inbox/channel-dispatcher.ts'
]);

/** Each value import's specifiers and module, skipping `import type`. */
function valueImports(source: string): { names: string[]; from: string }[] {
	const out: { names: string[]; from: string }[] = [];
	for (const m of source.matchAll(
		/\b(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/g
	)) {
		const names = [...m[1].matchAll(/(?:^|[{,\s])(?!type\s)(\w+)(?:\s+as\s+\w+)?(?=\s*[,}])/g)].map(
			(n) => n[1]
		);
		out.push({ names, from: m[2] });
	}
	return out;
}

function sendsDirectly(source: string): string[] {
	return valueImports(source).flatMap(({ names, from }) => [
		...(from === 'postmark' ? ['postmark'] : []),
		...names.filter((n) => SEND_FUNCTIONS.includes(n))
	]);
}

describe('mail goes through the outbox', () => {
	const files = sourceFiles(['src/**/*.{ts,svelte}'], SENDERS).filter(
		(f) => !/\.(spec|test)\.ts$/.test(f) && !f.endsWith('fixtures.ts')
	);

	it('finds the senders it is meant to refuse', () => {
		expect(sendsDirectly(`import { sendEmailWithTemplate } from './postmark-client';`)).toEqual([
			'sendEmailWithTemplate'
		]);
		expect(
			sendsDirectly(`import {\n\tfoo,\n\tsendTemplateBatch as s\n} from '#x/index.js';`)
		).toEqual(['sendTemplateBatch']);
		expect(sendsDirectly(`import { ServerClient } from 'postmark';`)).toEqual(['postmark']);
		expect(sendsDirectly(`import type { TemplatedEmail } from './postmark-client';`)).toEqual([]);
	});

	it('refuses a direct send outside the outbox and the allow-list', () => {
		const offenders = files
			.filter((f) => !NOT_YET_ON_THE_OUTBOX.has(f))
			.map((f) => ({ f, sends: sendsDirectly(readFileSync(f, 'utf8')) }))
			.filter(({ sends }) => sends.length > 0)
			.map(({ f, sends }) => `${f}: ${sends.join(', ')}`);
		expect(
			offenders,
			'Send through the outbox instead: put emailRow() in your db.batch, or call queueEmail(). ' +
				'docs/architecture/outbox.md'
		).toEqual([]);
	});

	it('keeps the allow-list to modules that still send directly', () => {
		const stale = [...NOT_YET_ON_THE_OUTBOX].filter(
			(f) => sendsDirectly(readFileSync(f, 'utf8')).length === 0
		);
		expect(stale, 'These no longer send directly: delete them from the list.').toEqual([]);
	});
});
