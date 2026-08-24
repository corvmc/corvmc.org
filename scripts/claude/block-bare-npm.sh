#!/usr/bin/env bash
# PreToolUse guard: this repo is pnpm-only.
#
# A global prettier 2.8.8 sits ahead of the project's prettier 3 on PATH, so
# `npx prettier` reports formatting results that are simply wrong — and an `npm
# install` writes a package-lock.json that nothing here consumes.
#
# Two traps this has to avoid, both found by the hook firing on itself:
#   1. "pnpm" ends in "npm", so match the leading token of a command segment,
#      never a bare substring.
#   2. A heredoc body is part of the command string. A commit message or a
#      generated file whose text happens to start a line with "npm run ..." is
#      documentation, not an invocation — strip heredoc bodies before scanning.
set -uo pipefail

payload=$(cat)

offender=$(printf '%s' "$payload" | node -e '
	let raw = "";
	process.stdin.on("data", (chunk) => (raw += chunk));
	process.stdin.on("end", () => {
		let command = "";
		try {
			command = JSON.parse(raw).tool_input?.command ?? "";
		} catch {
			process.exit(0);
		}

		// Drop heredoc bodies: everything between the opener and its terminator
		// is data the shell never executes.
		const kept = [];
		let terminator = null;
		for (const line of command.split("\n")) {
			if (terminator !== null) {
				if (line.trim() === terminator) terminator = null;
				continue;
			}
			kept.push(line);
			const opener = line.match(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
			if (opener) terminator = opener[2];
		}

		const hit = kept
			.join("\n")
			.split(/[;&|()\n]+/)
			.map((segment) => segment.trim())
			.find((segment) => /^(npm|npx)(\s|$)/.test(segment));

		if (hit) process.stdout.write(hit.split(/\s+/)[0]);
	});
' 2>/dev/null)

[ -n "$offender" ] || exit 0

cat >&2 <<MSG
Blocked: this repo is pnpm-only, and \`$offender\` is not.

A global prettier 2.8.8 shadows the project's prettier 3, so running the
project's tooling through npx reports results that do not match what CI checks.

  npm run <script>  ->  pnpm <script>
  npm install       ->  pnpm install
  npx <bin>         ->  pnpm exec <bin>

Script reference: docs/development/conventions.md#pnpm-script-reference
MSG
exit 2
