#!/usr/bin/env bash
set -e

CONFIG="$HOME/.codex/config.toml"
MODEL="mimo/mimo-v2.5-pro"

mkdir -p "$HOME/.codex"

if [ -f "$CONFIG" ]; then
  cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
fi

if grep -q '^model = ' "$CONFIG" 2>/dev/null; then
  sed -i "s|^model = .*|model = \"$MODEL\"|" "$CONFIG"
else
  printf 'model = "%s"\n' "$MODEL" | cat - "$CONFIG" > "$CONFIG.tmp"
  mv "$CONFIG.tmp" "$CONFIG"
fi

echo "Done. Codex model set to: $MODEL"
grep '^model = ' "$CONFIG"
