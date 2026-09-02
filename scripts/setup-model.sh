#!/usr/bin/env bash
# One-time setup for the on-device model tier.
#
# mlx-vlm is Python, so it lives in a venv rather than in node_modules. MLX is
# used over a GGUF runtime because prefill speed on Apple Silicon is the one
# resource a fanless machine is shortest of.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
  echo "Creating .venv"
  python3 -m venv .venv
fi

echo "Installing mlx-vlm"
.venv/bin/pip install --quiet --upgrade pip
# jinja2 is not pulled in by mlx-vlm, but apply_chat_template needs it — without
# it the server starts happily and then 500s on the first request.
.venv/bin/pip install --quiet mlx-vlm jinja2

echo
echo "Done. 'pnpm dev' now starts the local model alongside Studio."
echo "Weights download on first run, into ~/.cache/huggingface."
