#!/usr/bin/env bash
# Install (or `--uninstall`) a launchd job that runs `queue-sweep.mjs --notify` every 15 minutes,
# so a PR the queue dropped — or one stuck before it — reaches a person even when no session is
# open. It notifies; it never re-arms. Runs from the main checkout, not a worktree, because a
# worktree is deleted when its work lands and the job would go quiet without saying so.
set -euo pipefail

LABEL=org.corvmc.queue-sweep
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/corvmc-queue-sweep.log"
DOMAIN="gui/$(id -u)"

if [[ "${1:-}" == "--uninstall" ]]; then
	launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
	rm -f "$PLIST"
	echo "removed $LABEL"
	exit 0
fi

MAIN=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
SCRIPT="$MAIN/scripts/claude/queue-sweep.mjs"
NODE=$(command -v node)
GH=$(command -v gh)
[[ -f "$SCRIPT" ]] || { echo "no $SCRIPT — is the main checkout on a branch that has it?" >&2; exit 1; }

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array><string>$NODE</string><string>$SCRIPT</string><string>--notify</string></array>
	<key>WorkingDirectory</key><string>$MAIN</string>
	<key>EnvironmentVariables</key>
	<dict><key>PATH</key><string>$(dirname "$GH"):$(dirname "$NODE"):/usr/bin:/bin</string></dict>
	<key>StartInterval</key><integer>900</integer>
	<key>RunAtLoad</key><true/>
	<key>StandardOutPath</key><string>$LOG</string>
	<key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "installed $LABEL: every 15 min, log at $LOG"
