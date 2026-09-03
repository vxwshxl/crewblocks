#!/usr/bin/env bash
#
# Takes over the agent extension inside the CrewSurf profile.
#
# Why this exists: the browser ships an agent extension but then *replaces it at
# runtime* with a newer copy from the vendor's CDN. Rebranding the copy inside
# the .app is therefore pointless — the downloaded one wins. So the branding is
# applied where the browser actually loads it from: the profile.
#
# The manifest carries a "key" field, which is what pins the extension id. Keep
# it and the extension keeps its identity no matter what we change around it, so
# there is no re-signing and no id churn. Strip "update_url" in the same pass and
# the vendor's CDN can no longer overwrite the result.
#
# Safe to re-run. The first run stashes the untouched original next to the
# extension, and `--restore` puts it back.
#
set -euo pipefail

BRAND="CrewSurf"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${CREWSURF_PROFILE:-$HOME/Library/Application Support/BrowserClaw}"
EXT_ROOT="$PROFILE/Default/Extensions"
LOGO="$HERE/../Studio/public/logoCS.png"
SKIN="$HERE/skin"

if [[ ! -d "$EXT_ROOT" ]]; then
  echo "No CrewSurf profile at $PROFILE." >&2
  echo "Launch CrewSurf once so it creates one, then re-run this." >&2
  exit 1
fi

echo "Quitting ${BRAND} if it is running…"
osascript -e 'tell application id "com.browseros.BrowserClaw" to quit' 2>/dev/null || true
sleep 2
pkill -9 -f "CrewSurf.app/Contents/MacOS" 2>/dev/null || true

# The agent extension is the one that owns the new tab page.
TARGET=""
while IFS= read -r -d '' manifest; do
  if python3 -c "
import json,sys
m=json.load(open('$manifest'))
sys.exit(0 if (m.get('chrome_url_overrides') or {}).get('newtab') else 1)
" 2>/dev/null; then
    TARGET="$(dirname "$manifest")"
    break
  fi
done < <(find "$EXT_ROOT" -name manifest.json -maxdepth 3 -print0)

if [[ -z "$TARGET" ]]; then
  echo "Could not find the extension that owns the new tab page." >&2
  exit 1
fi
echo "Found it: ${TARGET#$EXT_ROOT/}"

BACKUP="$TARGET/.crewsurf-original"
# The stash used to be named for the old brand. Carry it across rather than
# stashing a second copy of an already-modified extension, which would make
# --restore restore the skin instead of the original.
if [[ -d "$TARGET/.crewser-original" && ! -d "$BACKUP" ]]; then
  mv "$TARGET/.crewser-original" "$BACKUP"
fi
if [[ "${1:-}" == "--restore" ]]; then
  if [[ -d "$BACKUP" ]]; then
    echo "Restoring the original extension…"
    find "$TARGET" -maxdepth 1 -mindepth 1 ! -name ".crewsurf-original" -exec rm -rf {} +
    cp -R "$BACKUP/." "$TARGET/"
    rm -rf "$BACKUP"
    echo "Restored."
  else
    echo "No backup to restore from." >&2
  fi
  exit 0
fi

if [[ ! -d "$BACKUP" ]]; then
  echo "Stashing the untouched original…"
  mkdir -p "$BACKUP"
  find "$TARGET" -maxdepth 1 -mindepth 1 ! -name ".crewsurf-original" -exec cp -R {} "$BACKUP/" \;
fi

# ------------------------------------------------------------------ manifest --
echo "Rewriting the manifest…"
python3 - "$TARGET" "$BRAND" <<'PY'
import json, sys
target, brand = sys.argv[1], sys.argv[2]
path = f"{target}/manifest.json"
m = json.load(open(path))

m["name"] = brand
m["short_name"] = brand
m["description"] = f"{brand} — your browser, driven by Qwen."
if "action" in m and isinstance(m["action"], dict):
    m["action"]["default_title"] = brand

# Without this the vendor's CDN reinstalls its own build over the top and every
# change below is silently reverted on the next update check.
m.pop("update_url", None)

# The live preview screenshots a tab the user is *not* looking at.
# captureVisibleTab cannot do that — by definition it returns the visible tab,
# which is the cockpit. Page.captureScreenshot over the debugger protocol can,
# and it is the only API that can. The price is a "CrewSurf is debugging this
# browser" bar while it is attached; the cockpit attaches only during a run and
# detaches at the end, and the preview toggle in the header disables it outright.
perms = m.setdefault("permissions", [])
if "debugger" not in perms:
    perms.append("debugger")

# "key" pins the extension id. Losing it would mint a new id, and the browser
# would treat this as a different extension and drop its stored settings.
assert "key" in m, "manifest has no key; the id would change"

json.dump(m, open(path, "w"), indent=2)
print(f"  name={brand}, update_url removed, id pinned")
PY

# --------------------------------------------------------------------- icons --
if [[ -f "$LOGO" ]]; then
  echo "Restamping icons…"
  while IFS= read -r -d '' png; do
    size="$(basename "$png" | grep -oE '[0-9]+' | head -1)"
    [[ -z "$size" ]] && size=128
    sips -z "$size" "$size" "$LOGO" --out "$png" >/dev/null 2>&1 || true
  done < <(find "$TARGET" -name "*.png" ! -path "*/.crewsurf-original/*" -print0)

  # Vector marks cannot be resampled from a PNG, so swap in one that embeds it.
  python3 - "$TARGET" "$LOGO" <<'PY'
import base64, os, sys
target, logo = sys.argv[1], sys.argv[2]
data = base64.b64encode(open(logo, "rb").read()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
       f'<image href="data:image/png;base64,{data}" width="512" height="512"/></svg>')
for root, _dirs, files in os.walk(target):
    if ".crewsurf-original" in root:
        continue
    for name in files:
        if name.lower().endswith(".svg"):
            open(os.path.join(root, name), "w").write(svg)
PY
fi

# --------------------------------------------------------------------- pages --
echo "Installing the CrewSurf cockpit…"
cp "$SKIN/newtab.html" "$TARGET/newtab.html"
cp "$SKIN/crewsurf-cockpit.js" "$TARGET/crewsurf-cockpit.js"
cp "$SKIN/markdown.js" "$TARGET/markdown.js"
cp "$SKIN/redact.js" "$TARGET/redact.js"

# ------------------------------------------------------------------ harness --
# The MCP screen lists the coding agents it can pair with. CrewSurf drives itself
# with Qwen, so that list is noise. The bundle carries the roster alongside an
# empty "hidden" array that its filter checks against, so filling that array in
# hides the lot without touching any rendering code.
echo "Hiding the third-party agent harnesses…"
python3 - "$TARGET" <<'PY'
import os, re, sys
target = sys.argv[1]

# Anchor on the literal roster, not the minified variable name, so a rebuilt
# bundle with different names still matches.
pattern = re.compile(
    r'(\[(?:"[^"]+",){2,}"[^"]+"\]\s*,\s*)(\w+)(\s*=\s*)\[\]'
)

patched = 0
for root, _dirs, names in os.walk(target):
    if ".crewsurf-original" in root:
        continue
    for name in names:
        if not name.endswith(".js"):
            continue
        path = os.path.join(root, name)
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if '"Claude Code"' not in text:
            continue

        def fill(match):
            roster = match.group(1).rstrip(", \t")
            if "Claude Code" not in roster:
                return match.group(0)
            return f"{match.group(1)}{match.group(2)}{match.group(3)}{roster}"

        updated, count = pattern.subn(fill, text, count=1)
        if count and updated != text:
            open(path, "w", encoding="utf-8").write(updated)
            patched += 1

print(f"  {patched} bundle(s) patched" if patched else "  roster not found — harnesses left visible")
PY

# ------------------------------------------------------------------- strings --
# Whatever branding is left in the vendor's own bundles — the side panel, the
# onboarding flow, the MCP screen — is text we can simply rewrite in place.
echo "Rewriting leftover strings…"
python3 - "$TARGET" "$BRAND" <<'PY'
import os, sys
target, brand = sys.argv[1], sys.argv[2]
pairs = [("BrowserOS neo", brand), ("BrowserClaw", brand), ("browserclaw", brand.lower()),
         ("BrowserOS", brand), ("browseros", brand.lower())]
exts = {".js", ".html", ".css", ".json", ".txt", ".md"}
hits = files = 0
for root, _dirs, names in os.walk(target):
    if ".crewsurf-original" in root:
        continue
    for name in names:
        if os.path.splitext(name)[1].lower() not in exts:
            continue
        path = os.path.join(root, name)
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        original = text
        for old, new in pairs:
            if old in text:
                hits += text.count(old)
                text = text.replace(old, new)
        if text != original:
            open(path, "w", encoding="utf-8").write(text)
            files += 1
print(f"  {hits} strings across {files} files")
PY

echo
echo "Done. Relaunch ${BRAND} — the new tab is now the CrewSurf cockpit."
echo "Undo any time with:  ./apply-skin.sh --restore"
