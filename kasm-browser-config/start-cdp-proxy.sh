#!/bin/bash
# Fix kasm_viewer to have write permissions (not read-only)
sed -i 's/kasm_viewer:.*:r$/kasm_viewer:'"$(grep kasm_user /home/kasm-user/.kasmpasswd | cut -d: -f2)"':wo/' /home/kasm-user/.kasmpasswd

sleep 5
while true; do
  socat TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222
  sleep 2
done
