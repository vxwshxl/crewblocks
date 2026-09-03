#!/usr/bin/env python3
"""
Rewrite product-name strings inside Chromium `.pak` resource files.

The menu bar, the About box and most of Settings read their text from these,
not from Info.plist, so a rebrand that skips them leaves "BrowserOS neo"
scattered through the UI.

A .pak is a flat table: a header, one (id, offset) entry per resource plus a
sentinel marking the end of the last one, optional aliases pointing at entry
*indices*, then the payload. Replacing text changes payload lengths, so every
offset after an edit shifts — which is why this rebuilds the file rather than
patching bytes in place. Ids, order and alias indices are all preserved, so
nothing that references a resource has to know this happened.

Only v4 and v5 exist in the wild; anything else is left untouched rather than
guessed at.

    repack_pak.py "Old Name=New" [more=replacements] -- file.pak [file.pak ...]
"""

import struct
import sys

V5_HEADER = 12  # version(4) + encoding(1) + pad(3) + resource_count(2) + alias_count(2)
V4_HEADER = 9   # version(4) + resource_count(4) + encoding(1)
ENTRY = 6       # id(2) + offset(4)
ALIAS = 4       # id(2) + entry_index(2)


def _parse(data):
    """Return (version, encoding, entries, aliases, header_bytes) or None."""
    version = struct.unpack_from("<I", data, 0)[0]

    if version == 5:
        encoding = data[4]
        count, alias_count = struct.unpack_from("<HH", data, 8)
        entry_start = V5_HEADER
    elif version == 4:
        count = struct.unpack_from("<I", data, 4)[0]
        encoding = data[8]
        alias_count = 0
        entry_start = V4_HEADER
    else:
        return None

    # count + 1 because the trailing sentinel entry supplies the final length.
    entries = []
    for i in range(count + 1):
        rid, off = struct.unpack_from("<HI", data, entry_start + i * ENTRY)
        entries.append((rid, off))

    alias_start = entry_start + (count + 1) * ENTRY
    aliases = data[alias_start:alias_start + alias_count * ALIAS]

    return version, encoding, entries, aliases, count, alias_count


def rewrite(path, replacements):
    with open(path, "rb") as fh:
        data = fh.read()

    parsed = _parse(data)
    if parsed is None:
        return 0
    version, encoding, entries, aliases, count, alias_count = parsed

    payloads = []
    hits = 0
    for i in range(count):
        start = entries[i][1]
        end = entries[i + 1][1]
        blob = data[start:end]
        for old, new in replacements:
            if old in blob:
                hits += blob.count(old)
                blob = blob.replace(old, new)
        payloads.append(blob)

    if hits == 0:
        return 0

    # Rebuild: the table is a fixed size (ids and counts are unchanged), so the
    # payload always begins at the same place; only the offsets within it move.
    if version == 5:
        header = struct.pack("<IBBBBHH", 5, encoding, 0, 0, 0, count, alias_count)
        data_start = V5_HEADER + (count + 1) * ENTRY + alias_count * ALIAS
    else:
        header = struct.pack("<IIB", 4, count, encoding)
        data_start = V4_HEADER + (count + 1) * ENTRY

    table = bytearray()
    offset = data_start
    for i in range(count):
        table += struct.pack("<HI", entries[i][0], offset)
        offset += len(payloads[i])
    # The sentinel keeps its id (conventionally 0) and points just past the end.
    table += struct.pack("<HI", entries[count][0], offset)

    with open(path, "wb") as fh:
        fh.write(header)
        fh.write(bytes(table))
        fh.write(aliases)
        for blob in payloads:
            fh.write(blob)

    return hits


def main(argv):
    if "--" not in argv:
        print(__doc__)
        return 2
    split = argv.index("--")
    pairs = []
    for spec in argv[:split]:
        old, _, new = spec.partition("=")
        pairs.append((old.encode(), new.encode()))
    # Longest first, so "BrowserOS neo" is consumed before a bare "BrowserOS"
    # can claim its prefix.
    pairs.sort(key=lambda p: len(p[0]), reverse=True)

    total_files = 0
    total_hits = 0
    for path in argv[split + 1:]:
        try:
            hits = rewrite(path, pairs)
        except Exception as exc:  # a corrupt pak must not abort the rebrand
            print(f"  skipped {path}: {exc}", file=sys.stderr)
            continue
        if hits:
            total_files += 1
            total_hits += hits
    print(f"  {total_hits} strings rewritten across {total_files} pak files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
