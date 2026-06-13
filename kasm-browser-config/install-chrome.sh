#!/bin/bash
# Install Google Chrome inside Kasm container (runs at startup if needed)
# This gives full Chrome Sync, "Sign in to Chrome", and Google password manager.

CHROME_BIN="/opt/google/chrome/google-chrome"

if [ -f "$CHROME_BIN" ]; then
    echo "Google Chrome already installed."
    exit 0
fi

echo "Installing Google Chrome..."

# Add Google's signing key and repo
apt-get update -qq
apt-get install -y -qq wget gnupg2 > /dev/null 2>&1

wget -q -O /tmp/google-chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"

if [ ! -f /tmp/google-chrome.deb ]; then
    echo "ERROR: Failed to download Google Chrome"
    exit 1
fi

# Install Chrome and its dependencies
apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1 || {
    # Fix broken dependencies if needed
    apt-get install -f -y -qq > /dev/null 2>&1
    apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1
}

rm -f /tmp/google-chrome.deb

if [ -f "$CHROME_BIN" ]; then
    echo "Google Chrome installed successfully: $(google-chrome --version 2>/dev/null)"
else
    echo "ERROR: Chrome installation failed"
    exit 1
fi
