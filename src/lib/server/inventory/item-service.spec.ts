import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
let deleteResult: unknown[] = [];
const insertedValues: Record<string, unknown>[] = [];
const updatedValues: Record<string, unknown>[] = [];

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: Record<string, unknown>) => {
				insertedValues.push(v);
				return { returning: vi.fn(() => Promise.resolve(insertResult)) };
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn((v: Record<string, unknown>) => {
				updatedValues.push(v);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve(updateResult))
					}))
				};
			})
		})),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve(deleteResult))
			}))
		}))
	}
}));

import {
	createCategory,
	updateCategory,
	deleteCategory,
	createItem,
	updateItem,
	softDeleteItem,
	restoreItem,
	ItemNotFoundError,
	CategoryNotFoundError,
	CategoryHasItemsError
} from './item-service';

describe('item-service', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		selectResult = [];
		selectResultQueue = [];
		insertResult = [];
		updateResult = [];
		deleteResult = [];
		insertedValues.length = 0;
		updatedValues.length = 0;
	});

	describe('createCategory', () => {
		it('inserts a category and returns it', async () => {
			const cat = { id: 'cat-1', name: 'Guitars', displayOrder: 0, pricingTier: 'major' };
			insertResult = [cat];

			const result = await createCategory({ name: 'Guitars', pricingTier: 'major' });
			expect(result).toEqual(cat);
		});
	});

	describe('updateCategory', () => {
		it('returns updated category', async () => {
			const cat = { id: 'cat-1', name: 'Amps', pricingTier: 'major' };
			updateResult = [cat];

			const result = await updateCategory('cat-1', { name: 'Amps' });
			expect(result).toEqual(cat);
		});

		it('throws CategoryNotFoundError when id does not exist', async () => {
			updateResult = [];
			await expect(updateCategory('bad-id', { name: 'X' })).rejects.toThrow(CategoryNotFoundError);
		});
	});

	describe('deleteCategory', () => {
		it('throws CategoryHasItemsError when items are assigned', async () => {
			selectResult = [{ id: 'eq-1' }];
			await expect(deleteCategory('cat-1')).rejects.toThrow(CategoryHasItemsError);
		});

		it('throws CategoryNotFoundError when id does not exist', async () => {
			selectResult = [];
			deleteResult = [];
			await expect(deleteCategory('bad-id')).rejects.toThrow(CategoryNotFoundError);
		});

		it('deletes category when no items assigned', async () => {
			selectResult = [];
			const cat = { id: 'cat-1', name: 'Empty' };
			deleteResult = [cat];

			const result = await deleteCategory('cat-1');
			expect(result).toEqual(cat);
		});
	});

	describe('createItem', () => {
		it('inserts an item with defaults', async () => {
			const item = { id: 'it-1', name: 'SM58', categoryId: 'cat-1', kind: 'serialized' };
			insertResult = [item];

			const result = await createItem({
				name: 'SM58',
				categoryId: 'cat-1',
				kind: 'serialized'
			});
			expect(result).toEqual(item);
		});

		/**
		 * You do not restock Les Pauls to a par level. Silently dropping the
		 * value keeps the row consistent with the check constraint instead of
		 * failing at the database with an opaque error.
		 */
		it('drops a reorder point on a serialized item', async () => {
			insertResult = [{ id: 'it-1' }];
			await createItem({
				name: 'Blues Deluxe',
				categoryId: 'cat-1',
				kind: 'serialized',
				reorderPoint: 3
			});
			expect(insertedValues[0]).toMatchObject({ reorderPoint: null, reorderQuantity: null });
		});

		it('keeps a reorder point on a bulk item', async () => {
			insertResult = [{ id: 'it-2' }];
			await createItem({
				name: 'XLR cable',
				categoryId: 'cat-1',
				kind: 'bulk',
				reorderPoint: 6,
				reorderQuantity: 12
			});
			expect(insertedValues[0]).toMatchObject({ reorderPoint: 6, reorderQuantity: 12 });
		});
	});

	describe('updateItem', () => {
		/**
		 * Flipping a serialized item to bulk would orphan its assets; flipping
		 * the other way would invent units nobody ever counted. Neither is a
		 * rename, so neither is an edit.
		 */
		it('never lets `kind` be changed after the fact', async () => {
			updateResult = [{ id: 'it-1' }];
			await updateItem('it-1', { name: 'Renamed', kind: 'bulk' } as never);
			expect(updatedValues[0]).not.toHaveProperty('kind');
		});
	});

	describe('updateItem', () => {
		it('throws ItemNotFoundError when no match', async () => {
			updateResult = [];
			await expect(updateItem('bad-id', { name: 'X' })).rejects.toThrow(ItemNotFoundError);
		});
	});

	describe('softDeleteItem', () => {
		it('sets deletedAt on the item row', async () => {
			const item = { id: 'eq-1', deletedAt: new Date() };
			updateResult = [item];

			const result = await softDeleteItem('eq-1');
			expect(result.deletedAt).toBeDefined();
		});

		it('throws ItemNotFoundError when not found', async () => {
			updateResult = [];
			await expect(softDeleteItem('bad-id')).rejects.toThrow(ItemNotFoundError);
		});
	});

	describe('restoreItem', () => {
		it('clears deletedAt', async () => {
			const item = { id: 'eq-1', deletedAt: null };
			updateResult = [item];

			const result = await restoreItem('eq-1');
			expect(result.deletedAt).toBeNull();
		});

		it('throws ItemNotFoundError when not found', async () => {
			updateResult = [];
			await expect(restoreItem('bad-id')).rejects.toThrow(ItemNotFoundError);
		});
	});
});
