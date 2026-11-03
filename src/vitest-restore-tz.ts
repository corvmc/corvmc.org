import { afterAll } from 'vitest';

// Specs set `process.env.TZ` to make club time and the process zone disagree.
// The server project's vmForks pool reuses the worker process, so an unrestored
// zone leaks into whichever file that worker runs next (#2230).
const original = process.env.TZ;

afterAll(() => {
	if (original === undefined) delete process.env.TZ;
	else process.env.TZ = original;
});
