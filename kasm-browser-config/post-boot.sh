#!/bin/bash
# Post-boot script for kasm-browser: installs Chrome + fixes permissions + launches Chrome
# Run after container start: docker exec --user root kasm-browser bash /tmp/post-boot.sh
# Then launch Chrome: docker exec -e DISPLAY=:10 -d kasm-browser /usr/bin/chromium

set -e

# Install Google Chrome if not present
CHROME_BIN="/opt/google/chrome/google-chrome"
if [ ! -f "$CHROME_BIN" ]; then
    echo "Installing Google Chrome..."
    apt-get update -qq
    apt-get install -y -qq wget gnupg2 > /dev/null 2>&1
    wget -q -O /tmp/google-chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
    apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1 || {
        apt-get install -f -y -qq > /dev/null 2>&1
        apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1
    }
    rm -f /tmp/google-chrome.deb
    echo "Installed: $($CHROME_BIN --version 2>/dev/null)"
else
    echo "Chrome already installed: $($CHROME_BIN --version 2>/dev/null)"
fi

# Fix .config ownership so symlink creation works
chown kasm-user:kasm-user /home/kasm-user/.config 2>/dev/null || true

# Create profile symlink if needed (Chrome → mounted Chromium dir)
if [ ! -L /home/kasm-user/.config/google-chrome ]; then
    rm -rf /home/kasm-user/.config/google-chrome 2>/dev/null
    ln -s /home/kasm-user/.config/chromium /home/kasm-user/.config/google-chrome
    chown -h kasm-user:kasm-user /home/kasm-user/.config/google-chrome
    echo "Profile symlink created"
fi

# Fix kasm_viewer write permissions (for Take Control)
sed -i 's/kasm_viewer:.*:r$/kasm_viewer:'"$(grep kasm_user /home/kasm-user/.kasmpasswd | cut -d: -f2)"':wo/' /home/kasm-user/.kasmpasswd 2>/dev/null || true

# Suppress "--no-sandbox" infobar via Chrome enterprise policy
mkdir -p /etc/opt/chrome/policies/managed
cat > /etc/opt/chrome/policies/managed/suppress.json << 'POLICY'
{
    "CommandLineFlagSecurityWarningsEnabled": false
}
POLICY
echo "Chrome policy installed (suppress command-line warnings)"

# Remove stock Chromium binary so only Chrome is used
rm -f /usr/bin/chromium-orig /usr/lib/chromium/chromium 2>/dev/null
echo "Stock Chromium binaries removed (Chrome only)"

echo "Post-boot complete."
