#!/usr/bin/env bash
# Runs Studio and the local model server together.
#
# One Ctrl-C stops both. The cleanup is the whole point: a model server left
# holding ~3 GB of unified memory after the app is gone is exactly what makes
# the next run swap on a 16 GB machine.
#
# Written for the bash macOS actually ships — 3.2, from 2007. That rules out
# `wait -n`, and there is no `setsid` either, so the process tree is walked by
# hand instead of being killed as a group.
set -uo pipefail

cd "$(dirname "$0")/.."

model_pid=""
studio_pid=""

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "Stopping..."

  for pid in "$model_pid" "$studio_pid"; do
    [ -n "$pid" ] || continue
    # Children first: killing pnpm alone orphans the next-server under it.
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done

  # Backstop. mlx_vlm.server is the one that must not survive, and it is
  # re-exec'd under python so the recorded pid may no longer name it.
  pkill -f "mlx_vlm.server" 2>/dev/null || true

  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if [ -x ".venv/bin/python" ]; then
  ./scripts/model-server.sh &
  model_pid=$!
else
  echo "No local model environment — running against the cloud tier only."
  echo "Run 'pnpm setup:model' if you want to run on-device."
fi

pnpm --dir Studio dev &
studio_pid=$!

echo "Studio      http://localhost:3000"
[ -n "$model_pid" ] && echo "Local model http://127.0.0.1:8081/v1"

# Exit as soon as either side dies, rather than pretending things are fine.
while :; do
  if [ -n "$model_pid" ] && ! kill -0 "$model_pid" 2>/dev/null; then
    echo "Local model server exited." >&2
    break
  fi
  if ! kill -0 "$studio_pid" 2>/dev/null; then
    echo "Studio exited." >&2
    break
  fi
  sleep 1
done
