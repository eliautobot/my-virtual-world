#!/bin/bash
# Browser Supervisor — monitors Chrome/Chromium and auto-restarts on crash.
# Runs as a background daemon started by override-startup.sh during container boot.
# Logs to /tmp/browser-supervisor.log for debugging.

LOG="/tmp/browser-supervisor.log"
export DISPLAY=:10
CHECK_INTERVAL=10  # seconds between health checks
RESTART_DELAY=3    # seconds to wait before relaunch after crash
MAX_RAPID_RESTARTS=5  # max restarts within the rapid window
RAPID_WINDOW=120      # seconds — if we hit MAX_RAPID_RESTARTS in this window, back off
BACKOFF_DELAY=30      # seconds to wait during backoff

# Track restart timestamps for rapid-restart detection
declare -a restart_times=()

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

is_browser_running() {
    # Match Google Chrome process specifically
    pgrep -f "google-chrome" > /dev/null 2>&1
}

is_cdp_healthy() {
    # Quick check: can we reach the CDP endpoint?
    curl -sf --max-time 2 http://127.0.0.1:9222/json/version > /dev/null 2>&1
}

count_recent_restarts() {
    local now
    now=$(date +%s)
    local cutoff=$((now - RAPID_WINDOW))
    local count=0
    local new_times=()
    for ts in "${restart_times[@]}"; do
        if [ "$ts" -ge "$cutoff" ]; then
            count=$((count + 1))
            new_times+=("$ts")
        fi
    done
    restart_times=("${new_times[@]}")
    echo "$count"
}

launch_browser() {
    log "Launching browser via /usr/bin/chromium wrapper..."
    # The chromium wrapper script handles Chrome vs Chromium selection,
    # stale lock cleanup, crash recovery, CDP flags, and stealth flags.
    DISPLAY=:10 nohup /usr/bin/chromium > /dev/null 2>&1 &
    sleep 5

    if is_browser_running; then
        log "Browser launched successfully (PID: $(pgrep -f '(chromium|google-chrome)' | head -1))"
        restart_times+=("$(date +%s)")
        return 0
    else
        log "ERROR: Browser failed to start"
        return 1
    fi
}

# --- Main loop ---

log "=== Browser Supervisor started ==="
log "Check interval: ${CHECK_INTERVAL}s | Restart delay: ${RESTART_DELAY}s"
log "Rapid restart limit: ${MAX_RAPID_RESTARTS} in ${RAPID_WINDOW}s"

# Wait for X server to be ready before doing anything
log "Waiting for X server on ${DISPLAY}..."
for i in $(seq 1 30); do
    if xdpyinfo -display "$DISPLAY" > /dev/null 2>&1; then
        log "X server ready"
        break
    fi
    sleep 2
done

# Give Kasm's own Chromium startup time to launch
sleep 15
log "Initial grace period complete — entering monitor loop"

while true; do
    if ! is_browser_running; then
        log "Browser process not found — crashed or was killed"

        recent=$(count_recent_restarts)
        if [ "$recent" -ge "$MAX_RAPID_RESTARTS" ]; then
            log "WARNING: ${recent} restarts in last ${RAPID_WINDOW}s — backing off ${BACKOFF_DELAY}s"
            sleep "$BACKOFF_DELAY"
        fi

        sleep "$RESTART_DELAY"
        launch_browser
    elif [ -f /tmp/no-cdp ]; then
        # CDP disabled — skip health check, browser is alive, that's enough
        :
    elif ! is_cdp_healthy; then
        log "Browser running but CDP unresponsive — possible hung process"
        # Don't kill immediately — give it a couple more chances
        sleep "$CHECK_INTERVAL"
        if is_browser_running && ! is_cdp_healthy; then
            log "CDP still unresponsive after retry — killing browser for restart"
            pkill -f "(chromium|google-chrome)" 2>/dev/null
            sleep "$RESTART_DELAY"
            launch_browser
        fi
    fi

    sleep "$CHECK_INTERVAL"
done
