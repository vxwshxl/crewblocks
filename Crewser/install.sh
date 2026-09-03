#!/usr/bin/env bash
#
# Installs the Crewser browser (a pinned BrowserOS neo build) into this folder.
#
# The browser is a third-party AGPL-3.0 binary from browseros-ai/BrowserOS. We do
# not vendor it into git — 150 MB of someone else's build has no business in this
# repo's history — so this script fetches it on demand and everything it writes is
# covered by .gitignore. Re-running is safe and idempotent.
#
#   ./install.sh              install if missing
#   ./install.sh --force      reinstall over an existing copy
#
set -euo pipefail

VERSION="0.49.3.1"
TAG="browserclaw/v0.49.3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/Crewser.app"
CACHE="$HERE/.cache"

# Apple silicon and Intel ship as separate images; universal is the safe fallback
# for anything we do not recognise.
case "$(uname -m)" in
  arm64)  ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)      ARCH="universal" ;;
esac

DMG_NAME="BrowserOS_neo_v${VERSION}_${ARCH}.dmg"
URL="https://github.com/browseros-ai/BrowserOS/releases/download/${TAG}/${DMG_NAME}"
DMG="$CACHE/$DMG_NAME"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only. On Linux/Windows, download a build from" >&2
  echo "https://github.com/browseros-ai/BrowserOS/releases and place it beside this script." >&2
  exit 1
fi

if [[ -d "$APP" && "${1:-}" != "--force" ]]; then
  echo "Crewser is already installed at $APP"
  echo "Re-run with --force to reinstall."
  exit 0
fi

mkdir -p "$CACHE"

if [[ ! -f "$DMG" ]]; then
  echo "Downloading $DMG_NAME (~147 MB)…"
  curl -fL --progress-bar "$URL" -o "$DMG.part"
  mv "$DMG.part" "$DMG"
else
  echo "Using cached $DMG_NAME"
fi

# Mount into a private mountpoint rather than /Volumes, so a half-finished run
# cannot collide with a copy the user mounted by hand.
MOUNT="$(mktemp -d)"
MOUNT_STAGE="$(mktemp -d)"
cleanup() { hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rmdir "$MOUNT" 2>/dev/null || true; }
trap 'cleanup; rm -rf "$MOUNT_STAGE"' EXIT

echo "Mounting…"
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -quiet

SRC="$(find "$MOUNT" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$SRC" ]]; then
  echo "No .app found inside the disk image." >&2
  exit 1
fi

# The app is branded while it still lives in a scratch directory. Once a bundle
# has been launched from its final path, macOS App Management refuses further
# writes into it, so "copy then modify" works exactly once and then starts
# failing halfway through. "Modify then copy" always works.
STAGED="$MOUNT_STAGE/Crewser.app"
echo "Copying out of the image…"
cp -R "$SRC" "$STAGED"

cleanup

echo
echo "Applying Crewser branding…"
echo
"$HERE/rebrand.sh" "$STAGED" --in-place

echo
echo "Installing to ${APP}…"
rm -rf "$APP"
cp -R "$STAGED" "$APP"

# Re-signing happened in the staging copy, so the bundle is ad-hoc signed rather
# than notarised. Clearing quarantine is what stops Gatekeeper turning the first
# launch into a right-click-Open dance and `open -a` failing silently.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo
echo "Launch it from the CrewBlocks dashboard (sidebar → Crewser), or:"
echo "  open -a \"$APP\""
