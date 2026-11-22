#!/usr/bin/env bash
# Store the TomTom API key in this app's encrypted DeepSpace secrets store.
#
# The key is read with hidden input and piped straight to the CLI, so it never
# lands in your shell history, a file, or a chat transcript. Redeploy after
# running this (deployed workers pick up secrets at deploy time).
#
#   bash scripts/set-tomtom-key.sh && npx deepspace deploy
set -euo pipefail
cd "$(dirname "$0")/.."

printf 'Paste your TomTom API key (input is hidden), then press Enter: '
IFS= read -rs key
echo
key="${key//[[:space:]]/}"
if [ ${#key} -lt 20 ]; then
  echo "That doesn't look like a TomTom key (too short). Nothing was saved." >&2
  exit 1
fi

# Quick sanity check against TomTom before saving (one request from your quota).
code=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://api.tomtom.com/routing/1/calculateRoute/30.2672,-97.7431:30.4019,-97.7239/json?key=${key}&traffic=true")
if [ "$code" != "200" ]; then
  echo "TomTom rejected the key (HTTP $code). Check it on developer.tomtom.com. Nothing was saved." >&2
  exit 1
fi

printf 'TOMTOM_API_KEY=%s\n' "$key" | npx deepspace secrets upload -
unset key
echo "Saved TOMTOM_API_KEY. Live traffic turns on after the next deploy."
