import { describe, it, expect } from 'vitest';
import { addRecipient, resolveTyped, unsent, type Recipient } from './invite-recipients';

const dez = { id: 'u-dez', name: 'Dez Halloran', email: 'dez@example.com' };
const kit = { id: 'u-kit', name: 'Kit Alvarez', email: 'kit@example.com' };

describe('resolveTyped', () => {
	it('takes the only search result for a typed name', () => {
		expect(resolveTyped('Dez Halloran', [dez])).toEqual({ kind: 'member', ...dez });
	});

	it('takes nothing when the name matches several members, or none', () => {
		expect(resolveTyped('a', [dez, kit])).toBeNull();
		expect(resolveTyped('Nobody', [])).toBeNull();
	});

	it('turns a typed address into an email invite', () => {
		expect(resolveTyped(' New@Example.com ', [])).toEqual({
			kind: 'email',
			email: 'new@example.com'
		});
	});

	it('prefers the member whose address was typed over an email invite', () => {
		expect(resolveTyped('DEZ@example.com', [dez, kit])).toEqual({ kind: 'member', ...dez });
	});
});

describe('addRecipient', () => {
	it('keeps one entry per person, by id or by address', () => {
		let list: Recipient[] = [];
		list = addRecipient(list, { kind: 'member', ...dez });
		list = addRecipient(list, { kind: 'member', ...dez });
		list = addRecipient(list, { kind: 'email', email: 'dez@example.com' });
		list = addRecipient(list, { kind: 'email', email: 'new@example.com' });
		list = addRecipient(list, { kind: 'email', email: 'NEW@example.com' });

		expect(list).toHaveLength(2);
	});
});

describe('unsent', () => {
	it('keeps only the recipients the server did not send, with their reasons', () => {
		const list: Recipient[] = [
			{ kind: 'member', ...dez },
			{ kind: 'member', ...kit },
			{ kind: 'email', email: 'new@example.com' }
		];

		const left = unsent(list, [
			{ kind: 'member', recipient: 'u-dez', sent: true },
			{ kind: 'member', recipient: 'u-kit', sent: false, reason: 'already invited' },
			{ kind: 'email', recipient: 'new@example.com', sent: false }
		]);

		expect(left.map((l) => l.recipient)).toEqual([list[1], list[2]]);
		expect(left[0].reason).toBe('already invited');
	});
});
