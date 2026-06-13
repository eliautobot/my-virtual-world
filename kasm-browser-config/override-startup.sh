#!/bin/bash
# Custom startup: set up Chrome profile, start browser supervisor, then launch Kasm VNC
#
# Kasm's built-in custom_startup.sh has its own restart loop using `pgrep -x chromium`,
# but that can't detect Google Chrome (`google-chrome`) so it breaks when Chrome is
# installed. We disable Kasm's loop (DISABLE_CUSTOM_STARTUP=1) and rely solely on
# our browser-supervisor.sh which correctly detects both Chrome and Chromium.

# Symlink Chrome profile to the mounted Chromium profile directory
# so Chrome uses the same persistent storage that's bind-mounted
if [ ! -L "$HOME/.config/google-chrome" ]; then
    rm -rf "$HOME/.config/google-chrome" 2>/dev/null
    ln -s "$HOME/.config/chromium" "$HOME/.config/google-chrome" 2>/dev/null || true
fi

# Disable Kasm's own browser restart loop — our supervisor handles this
export DISABLE_CUSTOM_STARTUP=1

# Start browser supervisor in the background.
# It watches Chrome/Chromium and auto-restarts on crash.
if [ -f /tmp/browser-supervisor.sh ]; then
    chmod +x /tmp/browser-supervisor.sh
    nohup /tmp/browser-supervisor.sh > /dev/null 2>&1 &
    echo "Browser supervisor started (PID: $!)"
fi

# Patch: skip wait_for_network_devices for --network host
sed 's/^wait_for_network_devices$/# wait_for_network_devices/' /dockerstartup/vnc_startup.sh > /tmp/vnc_patched.sh
chmod +x /tmp/vnc_patched.sh
exec /tmp/vnc_patched.sh "$@"
