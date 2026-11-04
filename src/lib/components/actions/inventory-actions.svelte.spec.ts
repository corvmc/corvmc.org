import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

// One file for every inventory action: they mock the same two modules, and each
// export below is the stub its own component's spec used before the merge.
vi.mock('#lib/remote/inventory.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = (action: string, names: string[]) => ({
		enhance: () => ({ method: 'POST', action: `?/${action}` }),
		fields: {
			...Object.fromEntries(names.map((name) => [name, field(name)])),
			allIssues: () => null
		},
		result: undefined
	});
	return {
		createItem: form('createItem', [
			'name',
			'description',
			'categoryId',
			'kind',
			'unitOfMeasure',
			'gtin',
			'isLoanable',
			'reorderPoint',
			'reorderQuantity',
			'resourceId',
			'notes'
		]),
		getEquipmentCategories: vi.fn(async () => [
			{ id: 'cat-1', name: 'Amplifiers' },
			{ id: 'cat-2', name: 'Microphones' }
		]),
		correctStock: form('correctStock', ['itemId', 'delta', 'notes']),
		bindTag: form('bindTag', ['assetId', 'assetTag']),
		createLoan: form('createLoan', [
			'userId',
			'itemId',
			'quantity',
			'requestedPickupDate',
			'estimatedReturnDate',
			'memberNotes'
		]),
		getAvailableItems: vi.fn(async () => [
			{ id: 'item-1', name: 'Fender Blues Deluxe' },
			{ id: 'item-2', name: 'Shure SM58' }
		]),
		markAcquisitionReimbursed: form('markAcquisitionReimbursed', ['id']),
		receiveStock: form('receiveStock', [
			'itemId',
			'quantity',
			'kind',
			'occurredAt',
			'sourceName',
			'unitValueCents',
			'reference',
			'fairValueBasis',
			'intendedUse',
			'fairValueCents',
			'monetized',
			'paidByUserId',
			'locationId',
			'notes'
		]),
		getLocations: vi.fn(async () => [{ id: 'loc-1', name: 'Main room', parentId: null }]),
		recordForm8282: form('recordForm8282', ['id', 'note']),
		recordForm8283: form('recordForm8283', ['id', 'signedOn', 'appraisalRef'])
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const AddItemAction = (await import('./AddItemAction.svelte')).default;
const AdjustStockAction = (await import('./AdjustStockAction.svelte')).default;
const BindTagAction = (await import('./BindTagAction.svelte')).default;
const CreateLoanAction = (await import('./CreateLoanAction.svelte')).default;
const MarkReimbursedAction = (await import('./MarkReimbursedAction.svelte')).default;
const ReceiveStockAction = (await import('./ReceiveStockAction.svelte')).default;
const RecordForm8282Action = (await import('./RecordForm8282Action.svelte')).default;
const RecordForm8283Action = (await import('./RecordForm8283Action.svelte')).default;

const named = (name: string) =>
	document.querySelector(`[role="dialog"] :is([name="${name}"], [name^="${name}/"])`);

/** Each action's trigger is its render container's only button; dialogs portal out. */
const openWith = async (...args: Parameters<typeof render>) => {
	const screen = await render(...args);
	await screen.locator.getByRole('button').click();
	return screen;
};

/**
 * Two defaults here cannot live in the schema, and one set of fields appears
 * only when it can be acted on. An unchecked box is simply absent from
 * `FormData`, so a schema `.default()` for "members can borrow this" would win
 * over whatever the operator did and could not be turned off — it is set in the
 * form instead. Getting either default backwards is silent: the record saves.
 */
describe('AddItemAction', () => {
	const open = async () => {
		await openWith(AddItemAction, {});
		await expect.element(page.getByLabelText('Tracked as')).toBeVisible();
		return page.getByRole('dialog');
	};

	// A stocktake is overwhelmingly one record per physical thing, and `bulk` is
	// what opens the reorder fields — so the common case was the one being
	// corrected on every entry.
	it('opens on the common case, one record per thing', async () => {
		await open();

		expect((named('kind') as unknown as HTMLSelectElement).value).toBe('serialized');
	});

	// You do not restock a Blues Deluxe to a par level, so these appear only
	// where they can be acted on rather than sitting greyed out.
	it('asks nothing about reordering a serialized item', async () => {
		await open();

		expect(named('reorderPoint')).toBeNull();
		expect(named('reorderQuantity')).toBeNull();
	});

	it('asks about reordering once the item is a count', async () => {
		await open();

		await userEvent.selectOptions(page.getByLabelText('Tracked as'), ['bulk']);

		await expect.element(page.getByLabelText('Reorder at')).toBeVisible();
		await expect.element(page.getByLabelText('Reorder quantity')).toBeVisible();
	});

	// Most of what CMC owns is there to be borrowed; "consumable" is the
	// exception a person opts into, so the box starts checked.
	it('assumes a new item can be borrowed', async () => {
		await open();

		expect((named('isLoanable') as unknown as HTMLInputElement).checked).toBe(true);
	});

	// The category list is this component's own query rather than a prop, so an
	// empty select here is a silently uncategorised item.
	it('offers the categories it loaded, inside a real select', async () => {
		await open();

		const categories = named('categoryId') as unknown as HTMLSelectElement;
		expect(Array.from(categories.options, (o) => o.value)).toEqual(['cat-1', 'cat-2']);
	});

	it('defaults the unit to a single thing', async () => {
		await open();

		expect((named('unitOfMeasure') as unknown as HTMLSelectElement).value).toBe('each');
	});
});

/**
 * The one action that does arithmetic on the operator's behalf. A stocktake
 * produces a *total* off a shelf; the ledger stores a *difference*. Getting the
 * subtraction or its sign wrong writes a correction in the wrong direction and
 * doubles the discrepancy it was meant to close — and nothing on screen would
 * say so, because the box the operator typed in is not the field that submits.
 */
describe('AdjustStockAction', () => {
	const delta = () =>
		document.querySelector('input:is([name="delta"], [name^="delta/"])') as HTMLInputElement;

	const open = async (props: Record<string, unknown> = {}) => {
		await openWith(AdjustStockAction, { itemId: 'item-1', onHand: 8, ...props });
		return page.getByRole('dialog');
	};

	/** The line under the box; `data-direction` is add, remove or none. */
	const preview = () => page.getByRole('dialog').getByTestId('stocktake-preview');

	const count = async (value: string) => {
		await userEvent.fill(page.getByLabelText('Counted on the shelf'), value);
	};

	// A box pre-filled with the number being checked invites confirming the
	// system rather than the shelf, which is the one thing a stocktake is for.
	it('opens with an empty box and nothing to submit', async () => {
		await expect.element(await open()).toBeVisible();

		const counted = document.querySelector('[data-testid="stocktake-counted"]') as HTMLInputElement;
		expect(counted.value).toBe('');
		expect(delta().value).toBe('');
	});

	it('submits the surplus, not the count, when the shelf holds more', async () => {
		await open();

		await count('12');

		await vi.waitFor(() => expect(delta().value).toBe('4'));
		await expect.element(preview()).toHaveAttribute('data-direction', 'add');
		await expect.element(preview()).toMatchTextContent(String(4));
	});

	// The half that is easy to get wrong by hand, and the half that doubles the
	// error when it is: a shortfall has to submit a negative number.
	it('submits a negative delta when the shelf holds fewer', async () => {
		await open();

		await count('3');

		await vi.waitFor(() => expect(delta().value).toBe('-5'));
		await expect.element(preview()).toHaveAttribute('data-direction', 'remove');
		await expect.element(preview()).toMatchTextContent(String(5));
	});

	it('submits zero, and says so, when the count matches', async () => {
		await open();

		await count('8');

		await vi.waitFor(() => expect(delta().value).toBe('0'));
		await expect.element(preview()).toHaveAttribute('data-direction', 'none');
	});

	// Half a cable is a typo, not a count. Truncating keeps the ledger integral
	// rather than rejecting the entry and losing what was counted.
	it('truncates a fractional count', async () => {
		await open();

		await count('12.7');

		await vi.waitFor(() => expect(delta().value).toBe('4'));
	});
});

/**
 * One prop turns this from "bind a tag" into "rebind a tag": the trigger, the
 * modal title and the panel above the field all flip on `currentTag`. A rebind
 * is a *different* claim — the unit keeps its id, loans and repairs, and only
 * the sticker changes. What a scan *means* is `parseScan` (`utils/scan.spec.ts`).
 */
describe('BindTagAction', () => {
	const open = async (props: Record<string, unknown> = {}) => {
		await openWith(BindTagAction, { assetId: 'asset-3', ...props });
		return page.getByRole('dialog');
	};

	const TAG = 'CMC-000110';
	/** The panel above the field: one line for a bind, two for a rebind. */
	const context = () => page.getByRole('dialog').getByTestId('bind-tag-context');

	it('offers to bind when the unit wears no tag', async () => {
		await expect.element(await open()).toBeVisible();

		await expect.element(context()).toBeVisible();
		expect(context().getByCss('p').elements()).toHaveLength(1);
		expect(context().getByCss('strong').query()).toBeNull();
	});

	// A staffer rebinding needs to know which sticker they are replacing —
	// the unit in their hands may be one of several on the bench.
	it('names the tag being replaced when there is one', async () => {
		await expect.element(await open({ currentTag: TAG })).toBeVisible();

		await expect.element(context().getByCss('strong')).toMatchTextContent(TAG);
	});

	// The reassurance is the whole reason a rebind is offered rather than a
	// delete-and-recreate: identity is the record, not the label stuck to it.
	it('says a rebind keeps the history attached to the unit', async () => {
		await expect.element(await open({ currentTag: TAG })).toBeVisible();

		// The second line is the reassurance; the first only names the tag.
		await expect.element(context().getByCss('p').nth(1)).toBeVisible();
	});

	// Pre-filling the field would submit the tag already bound — a rebind onto
	// itself, which reads as a save that did nothing.
	it('opens the field empty rather than pre-filled with the tag being replaced', async () => {
		await expect.element(await open({ currentTag: TAG })).toBeVisible();

		expect((named('assetTag') as HTMLInputElement).value).toBe('');
	});
});

/**
 * This equipment picker has been silently empty twice: first it fetched a route
 * that does not exist, then `FormField` rendered its `<option>` children
 * *instead of* the `<select>`, leaving bare text that submitted nothing. So the
 * shape is what is pinned, not either fix: a real `<select>` with a real
 * `<option>` per item.
 */
describe('CreateLoanAction', () => {
	const equipment = () =>
		document.querySelector(
			'[role="dialog"] select:is([name="itemId"], [name^="itemId/"])'
		) as unknown as HTMLSelectElement;

	const open = async () => {
		await openWith(CreateLoanAction, {});
		// The whole form sits behind `await getAvailableItems()`, so wait for a field
		// that is *not* under test.
		await expect.element(page.getByLabelText('Quantity')).toBeVisible();
		return page.getByRole('dialog');
	};

	beforeEach(() => {
		// MemberPicker searches over HTTP rather than through a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('[]'))
		);
	});

	it('offers the available equipment inside a real select', async () => {
		await open();

		expect(equipment()).not.toBeNull();
		expect(Array.from(equipment().options, (o) => o.value)).toEqual(['', 'item-1', 'item-2']);
		expect(Array.from(equipment().options, (o) => o.textContent?.trim())).toEqual([
			'-- Select equipment --',
			'Fender Blues Deluxe',
			'Shure SM58'
		]);
	});

	// An empty first option that is *selected* reads as a prompt. Without a value
	// of its own the closed select would show the first real item, which is an
	// answer nobody gave.
	it('starts on the prompt rather than on the first item', async () => {
		await open();

		expect(equipment().value).toBe('');
	});

	it('defaults the quantity to one', async () => {
		await open();

		await expect.element(page.getByLabelText('Quantity')).toHaveValue(1);
	});
});

/**
 * The dialog is one sentence, and the sentence is the whole component: who is
 * being recorded as paid back, how much, and — the part staff get wrong — that
 * pressing this moves no money. The amount arrives in cents and is read by a
 * person, so `formatCents` is the one piece of arithmetic here; printing 4500
 * instead of $45.00 is the failure it exists to prevent.
 */
describe('MarkReimbursedAction', () => {
	const open = async (props: Record<string, unknown> = {}) => {
		await openWith(MarkReimbursedAction, { acquisitionId: 'acq-2', ...props });
		return page.getByRole('dialog');
	};

	const sentence = () => document.querySelector('[role="dialog"]')?.textContent ?? '';

	it('reads the amount back in dollars, not in cents', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox', amountCents: 4500 })).toBeVisible();

		expect(sentence()).toContain('Jamie Fox has been paid back for $45.00');
	});

	// The whole point of the dialog. Nothing here reaches a bank, and a staffer
	// who thinks it does will not go and make the transfer.
	it('says out loud that pressing it sends no money', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox', amountCents: 4500 })).toBeVisible();

		expect(sentence()).toContain('does not send any money');
	});

	// An acquisition can be recorded without a price. Claiming an amount of
	// $0.00 would be a statement about the transfer that nobody made.
	it('claims no amount when none was recorded', async () => {
		await expect.element(await open({ paidByName: 'Jamie Fox' })).toBeVisible();

		expect(sentence()).toContain('Jamie Fox has been paid back.');
		expect(sentence()).not.toContain('$');
	});

	// Older rows predate the payer being captured; the sentence still has to
	// parse, because it is the only thing confirming what is about to be written.
	it('still reads as a sentence when nobody is named', async () => {
		await expect.element(await open({ amountCents: 1200 })).toBeVisible();

		expect(sentence()).toContain('whoever paid has been paid back for $12.00');
	});
});

/**
 * A select decides which questions the IRS gets asked. Only a gift owes the
 * FASB ASU 2020-07 disclosure, so the gift fields are an allow-list — donation
 * or grant — not `kind !== 'purchase'`. That negation was right for three kinds
 * and wrong the moment `opening_balance` arrived, and a fifth kind is exactly
 * the change that reintroduces it.
 */
describe('ReceiveStockAction', () => {
	const open = async () => {
		await openWith(ReceiveStockAction, { itemId: 'item-3' });
		await expect.element(page.getByLabelText('How it arrived')).toBeVisible();
		return page.getByRole('dialog');
	};

	const arrivedAs = async (kind: string) => {
		await userEvent.selectOptions(page.getByLabelText('How it arrived'), [kind]);
	};

	it('opens as a purchase, which owes no disclosure', async () => {
		await open();

		expect((named('kind') as unknown as HTMLSelectElement).value).toBe('purchase');
		expect(named('fairValueBasis')).toBeNull();
		expect(named('monetized')).toBeNull();
	});

	for (const gift of ['donation', 'grant']) {
		it(`asks a ${gift} how its value was arrived at`, async () => {
			await open();

			await arrivedAs(gift);

			await expect.element(page.getByLabelText('How the value was determined')).toBeVisible();
			// ASU 2020-07 discloses sold and utilized gifts on separate lines.
			expect(named('monetized')).not.toBeNull();
		});
	}

	// The kind the allow-list exists for. An opening balance is stock the
	// collective already had; nobody gave it, so there is no donor, no fair
	// value to justify and nothing to disclose.
	it('asks an opening balance none of it', async () => {
		await open();

		await arrivedAs('opening_balance');

		await vi.waitFor(() => expect(named('fairValueBasis')).toBeNull());
		expect(named('intendedUse')).toBeNull();
		expect(named('monetized')).toBeNull();
		expect(named('sourceName')).toBeNull();
	});

	// A purchase has a supplier and a gift has a donor. The same field, and the
	// wrong caption on it puts a supplier's name in the donor column.
	it('renames the counterparty for what it is', async () => {
		await open();
		const caption = () =>
			(named('sourceName') as HTMLInputElement | null)?.labels?.[0]?.textContent?.trim();
		const asPurchase = caption();
		expect(asPurchase).toBeTruthy();

		await arrivedAs('donation');

		await vi.waitFor(() => expect(caption()).toBeTruthy());
		await vi.waitFor(() => expect(caption()).not.toBe(asPurchase));
	});

	// Blank means the collective's own card, which is the common case — so a
	// reimbursement is only owed when somebody is actually named.
	it('posts nobody as having fronted the money until somebody is named', async () => {
		await open();

		const hidden = named('paidByUserId') as unknown as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('');
	});
});

// The due date is an IRS deadline derived from an instant, so it must be shown
// as the club's calendar day: an evening retirement in Corvallis is already the
// next day in UTC, and the late direction is the costly one.
describe('RecordForm8282Action', () => {
	it('shows the due date as the club-time day, not the UTC day', async () => {
		// 7pm PDT on Oct 27 is 02:00 UTC on Oct 28.
		await openWith(RecordForm8282Action, {
			assetId: 'asset-1',
			dueBy: new Date('2026-10-28T02:00:00Z')
		});
		const clubDay = '2026-10-27';
		const utcDay = '2026-10-28';

		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByText(clubDay)).toBeVisible();
		expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(utcDay);
	});
});

/**
 * Two decisions, both about an acknowledgment already on file. The trigger
 * flips between recording one and editing one, and the stored `Date` is cut back
 * to the `yyyy-mm-dd` a date input will accept — a `Date` handed straight to the
 * field renders blank, and an edit saved blank erases the signature date that
 * decides whether a later disposal owes a Form 8282.
 */
describe('RecordForm8283Action', () => {
	const open = async (props: Record<string, unknown> = {}) => {
		await openWith(RecordForm8283Action, { acquisitionId: 'acq-4', ...props });
		return page.getByRole('dialog');
	};

	const input = (name: string) =>
		document.querySelector(
			`[role="dialog"] input:is([name="${name}"], [name^="${name}/"])`
		) as HTMLInputElement;

	// The trigger sits in a row of acquisitions. Which of the two it says is the
	// only signal that this gift's acknowledgment is already on file.
	// Which words each says is copy; that the two differ is the signal.
	it('says something different once an acknowledgment is on file', async () => {
		const blank = await render(RecordForm8283Action, { acquisitionId: 'acq-4' });
		const filed = await render(RecordForm8283Action, {
			acquisitionId: 'acq-4',
			signedOn: new Date('2026-03-14T00:00:00Z')
		});

		const record = blank.locator.getByRole('button');
		const edit = filed.locator.getByRole('button');
		await expect.element(record).toBeVisible();
		await expect.element(edit).toBeVisible();
		expect(edit.element().textContent?.trim()).not.toBe(record.element().textContent?.trim());
	});

	// A date input takes `yyyy-mm-dd` and nothing else; anything longer is
	// rejected silently and the field renders empty.
	it('pre-fills the date already signed', async () => {
		await expect.element(await open({ signedOn: new Date('2026-03-14T00:00:00Z') })).toBeVisible();

		expect(input('signedOn').value).toBe('2026-03-14');
	});

	it('leaves the date empty when none was recorded', async () => {
		await expect.element(await open()).toBeVisible();

		expect(input('signedOn').value).toBe('');
	});

	// `?? ''` rather than a bare forward: the column is nullable, and `null` in a
	// text input renders the word "null" for the staffer to delete by hand.
	it('renders a missing appraisal reference as an empty field', async () => {
		await expect.element(await open({ appraisalRef: null })).toBeVisible();

		expect(input('appraisalRef').value).toBe('');
	});

	it('pre-fills an appraisal reference that exists', async () => {
		await expect.element(await open({ appraisalRef: 'Cabinet 3, folder 11' })).toBeVisible();

		expect(input('appraisalRef').value).toBe('Cabinet 3, folder 11');
	});
});
