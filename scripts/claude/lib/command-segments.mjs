/**
 * Command parsing shared by the `PreToolUse` Bash guards in this directory.
 *
 * Both traps below were found by `block-bare-npm.sh` firing on itself, and both
 * apply to every guard that scans a command string, so they live here rather
 * than in whichever guard hit them first:
 *
 *   1. A heredoc body is part of the command string. A commit message, or a doc
 *      that explains the very command being guarded, is data the shell never
 *      executes — strip those bodies before scanning.
 *   2. Match the leading token of a segment, never a bare substring. "pnpm" ends
 *      in "npm"; `git commit -m "run pnpm lint"` runs no linter.
 *
 * Run directly (`node command-segments.mjs`), it reads a hook payload on stdin
 * and prints one segment per line, which is all `block-bare-npm.sh` needs.
 */

/**
 * Everything between a heredoc opener and its terminator, dropped. The opener
 * line itself is kept: it is a real part of the command.
 */
export function stripHeredocs(command) {
	const kept = [];
	let terminator = null;

	for (const line of command.split('\n')) {
		if (terminator !== null) {
			if (line.trim() === terminator) terminator = null;
			continue;
		}
		kept.push(line);
		const opener = line.match(/<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/);
		if (opener) terminator = opener[2];
	}

	return kept.join('\n');
}

/**
 * The command's separately-invoked pieces, trimmed and with empties dropped.
 * Splitting on the shell's separators is what makes "leading token" mean
 * something for a chained command — `git fetch && pnpm lint` has two segments,
 * and only the second one runs a linter.
 */
export function commandSegments(command) {
	return stripHeredocs(command)
		.split(/[;&|()\n]+/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

/** The command a `PreToolUse` payload describes, or `''` if it is not one. */
export function readCommand(raw) {
	try {
		return JSON.parse(raw).tool_input?.command ?? '';
	} catch {
		return '';
	}
}

/** Reads a hook payload from stdin. Guards call this; nothing else should. */
export async function readPayload() {
	let raw = '';
	for await (const chunk of process.stdin) raw += chunk;
	return readCommand(raw);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const command = await readPayload();
	if (command) process.stdout.write(commandSegments(command).join('\n'));
}
