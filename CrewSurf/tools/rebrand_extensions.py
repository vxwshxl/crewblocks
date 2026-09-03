#!/usr/bin/env python3
"""
Rebrand every bundled extension in an app bundle and fix up the id map.

Re-signing a .crx mints a new extension id, so `bundled_extensions.json` — which
maps id to file — has to be rewritten in the same pass or the browser looks for
extensions that no longer exist under those names.

Each extension gets its **own** key, named for the id it used to have. An id is
just a digest of the public key, so signing two extensions with one key gives
them the same id and the second silently overwrites the first.

Keys live outside the app bundle and are reused, which keeps ids stable across
reinstalls. A fresh key every run would mint a new id every run, and the browser
would treat each one as a brand new extension and drop the profile data
belonging to the old one.

    rebrand_extensions.py <app-bundle> <key-dir> <workdir> <logo.png> "Old=New" [...]
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import repack_crx  # noqa: E402


def find_extension_dir(app):
    """The directory holding bundled_extensions.json, wherever it sits."""
    for dirpath, _dirs, files in os.walk(app):
        if "bundled_extensions.json" in files:
            return dirpath
    return None


def main(argv):
    if len(argv) < 5:
        print(__doc__)
        return 2
    app, key_dir, workdir, logo = argv[:4]
    os.makedirs(key_dir, exist_ok=True)
    pairs = []
    for spec in argv[4:]:
        old, _, new = spec.partition("=")
        pairs.append((old, new))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)

    ext_dir = find_extension_dir(app)
    if not ext_dir:
        print("  no bundled extensions found", file=sys.stderr)
        return 0

    manifest_path = os.path.join(ext_dir, "bundled_extensions.json")
    try:
        manifest = json.load(open(manifest_path))
    except (OSError, ValueError) as exc:
        print(f"  could not read bundled_extensions.json: {exc}", file=sys.stderr)
        return 0

    os.makedirs(workdir, exist_ok=True)
    rebuilt = {}
    total = 0

    for old_id, entry in manifest.items():
        crx_name = entry.get("external_crx", f"{old_id}.crx")
        crx_path = os.path.join(ext_dir, crx_name)
        if not os.path.isfile(crx_path):
            rebuilt[old_id] = entry
            continue

        work = os.path.join(workdir, old_id)
        staged = os.path.join(workdir, f"{old_id}.new.crx")

        extracted = os.path.join(work, "ext")
        os.makedirs(work, exist_ok=True)
        repack_crx.unpack(crx_path, extracted)
        hits = repack_crx.rebrand(extracted, pairs, logo)

        zip_path = os.path.join(work, "payload.zip")
        repack_crx.make_zip(extracted, zip_path)
        # Keyed by the original id so each extension keeps its own identity, and
        # so the same id comes back on every reinstall.
        ext_key = os.path.join(key_dir, f"{old_id}.pem")
        public_key, signature, new_id, shd, zip_bytes = repack_crx.sign(
            zip_path, ext_key, work
        )
        repack_crx.write_crx(staged, public_key, signature, shd, zip_bytes)

        # Replace the old file with one named for the new id, keeping the
        # convention that the file name and the id agree.
        os.remove(crx_path)
        shutil.copy(staged, os.path.join(ext_dir, f"{new_id}.crx"))

        new_entry = dict(entry)
        new_entry["external_crx"] = f"{new_id}.crx"
        rebuilt[new_id] = new_entry
        total += hits
        print(f"  {old_id[:12]}… -> {new_id[:12]}…  ({hits} strings)", file=sys.stderr)

    with open(manifest_path, "w") as fh:
        json.dump(rebuilt, fh, indent=2)

    print(f"  {total} strings rewritten across {len(rebuilt)} extensions", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
