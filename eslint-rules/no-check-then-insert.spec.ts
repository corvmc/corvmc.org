import rule from './no-check-then-insert.js';
import { tsRuleTester } from './rule-tester.js';

const tester = tsRuleTester();

const read = 'const [existing] = await db.select().from(t).where(eq(t.key, k)).limit(1);';

tester.run('no-check-then-insert', rule as never, {
	valid: [
		// The fix: the insert names what a conflict does, then re-reads.
		`async function f() { ${read} if (existing) return existing.id; await db.insert(t).values(v).onConflictDoNothing(); }`,
		`async function f() { ${read} if (!existing) await db.insert(t).values(v).onConflictDoUpdate({ target: t.key, set: v }); }`,
		// A clash check whose insert says what a conflict does, or sits in a try.
		`async function f() { ${read} if (existing) throw new TakenError(); const [row] = await db.insert(t).values(v).onConflictDoNothing().returning(); if (!row) throw new TakenError(); }`,
		`async function f() { ${read} if (existing) throw new TakenError(); try { await db.insert(t).values(v); } catch (err) { throw new TakenError(); } }`,
		// A not-found check is not a clash.
		`async function f() { ${read} if (!existing) throw new NotFoundError(); await db.insert(t).values(v); }`,
		// The refusal in a branch the insert is not in.
		`async function f() { if (a) { ${read} if (existing.done) throw new DoneError(); return; } await db.insert(t).values(v); }`,
		// A different table.
		`async function f() { ${read} if (existing) return existing.id; await db.insert(other).values(v); }`,
		// A read nothing branches on.
		`async function f() { ${read} log(existing); await db.insert(t).values(v); }`,
		// An unlimited read.
		`async function f() { const rows = await db.select().from(t); if (rows.length) return; await db.insert(t).values(v); }`,
		// The read and the insert in different functions.
		`async function find() { ${read} return existing; }
		 async function f() { const e = await find(); if (e) return e; await db.insert(t).values(v); }`
	],
	invalid: [
		{
			// Throw on a clash, insert unguarded: the second caller gets a raw UNIQUE.
			code: `async function f() { ${read} if (existing) throw new TakenError(); await db.insert(t).values(v); }`,
			errors: [{ messageId: 'taken' }]
		},
		{
			// The clash in a compound test, the insert built for a batch.
			code: `async function f() { const clash = await db.select().from(t).limit(1); if (clash.length > 0 || reserved) throw new TakenError(); const insert = db.insert(t).values(v); await db.batch([insert]); }`,
			errors: [{ messageId: 'taken' }]
		},
		{
			// Return on a hit, insert on a miss.
			code: `async function f() { ${read} if (existing) return existing.id; const [row] = await db.insert(t).values(v).returning(); return row.id; }`,
			errors: [{ messageId: 'race' }]
		},
		{
			// Update on a hit, insert on a miss.
			code: `async function f() { ${read} if (existing) { await db.update(t).set(v); } else { await db.insert(t).values(v); } }`,
			errors: [{ messageId: 'race' }]
		},
		{
			// Insert inside the miss branch, the read inside Promise.all.
			code: `async function f() {
				const [[found], [other]] = await Promise.all([db.select().from(t).limit(1), db.select().from(u).limit(1)]);
				if (!found) await db.insert(t).values(v);
			}`,
			errors: [{ messageId: 'race' }]
		},
		{
			// Assigned rather than declared, in branches.
			code: `async function f() { let existing; if (a) { [existing] = await db.select().from(t).limit(1); } if (existing) return existing; await db.insert(t).values(v); }`,
			errors: [{ messageId: 'race' }]
		}
	]
});
