#!/usr/bin/env python3
"""
Rebrand and re-sign a bundled Chromium extension (CRX3).

The browser's own agent UI — the new tab page, the side panel — ships as signed
.crx files, so it is the one layer the .pak rewrite cannot reach. Editing one
means repacking it, and a CRX3's id *is* its public key: change the contents and
you must re-sign, which mints a new id. That is fine here because the id appears
in exactly one place, `bundled_extensions.json`, which this rewrites to match.

CRX3 layout:

    "Cr24" | version=3 | header_len | CrxFileHeader protobuf | zip payload

and the RSA signature covers

    b"CRX3 SignedData\\x00" | len(signed_header_data) | signed_header_data | zip

Signing goes through the `openssl` CLI rather than a Python crypto package, so
this has no dependencies beyond the standard library.

    repack_crx.py <in.crx> <out.crx> <workdir> <logo.png> "Old=New" [more=pairs]

Prints the new extension id on stdout.
"""

import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile

TEXT_SUFFIXES = {".js", ".html", ".json", ".css", ".svg", ".txt", ".md"}
SIGNATURE_CONTEXT = b"CRX3 SignedData\x00"


def _varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _tag(field, wire=2):
    return _varint((field << 3) | wire)


def _field(field, payload):
    return _tag(field) + _varint(len(payload)) + payload


def unpack(crx_path, dest):
    """Split a CRX3 into its zip payload and extract it."""
    blob = open(crx_path, "rb").read()
    if blob[:4] != b"Cr24":
        raise ValueError("not a CRX file")
    _version, header_len = struct.unpack_from("<II", blob, 4)
    zip_bytes = blob[12 + header_len:]

    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)
    tmp_zip = dest + ".zip"
    open(tmp_zip, "wb").write(zip_bytes)
    with zipfile.ZipFile(tmp_zip) as zf:
        zf.extractall(dest)
    os.remove(tmp_zip)


def rebrand(root, replacements, logo):
    """Rewrite brand strings in text files and restamp every raster icon."""
    hits = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            suffix = os.path.splitext(name)[1].lower()

            if suffix in TEXT_SUFFIXES:
                try:
                    text = open(path, encoding="utf-8").read()
                except (UnicodeDecodeError, OSError):
                    continue
                original = text
                for old, new in replacements:
                    if old in text:
                        hits += text.count(old)
                        text = text.replace(old, new)
                if text != original:
                    open(path, "w", encoding="utf-8").write(text)

            # Icons are square PNGs named by pixel size; sips rewrites them in
            # place at whatever size they already are.
            elif suffix == ".png" and logo and os.path.isfile(logo):
                match = re.search(r"(\d+)", name)
                size = int(match.group(1)) if match else 128
                subprocess.run(
                    ["sips", "-z", str(size), str(size), logo, "--out", path],
                    capture_output=True,
                )

    # A vector logo cannot be resized from a PNG, so it is replaced by an SVG
    # that simply embeds one — same file name, same dimensions, our mark.
    if logo and os.path.isfile(logo):
        import base64
        data = base64.b64encode(open(logo, "rb").read()).decode()
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<image href="data:image/png;base64,{data}" width="512" height="512"/>'
            "</svg>"
        )
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if name.lower().endswith(".svg"):
                    open(os.path.join(dirpath, name), "w", encoding="utf-8").write(svg)

    return hits


def make_zip(root, out_path):
    """Deterministic zip: sorted names, fixed timestamps, deflate."""
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirs, files in os.walk(root):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, root)
                info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                zf.writestr(info, open(full, "rb").read())


def sign(zip_path, key_path, workdir):
    """Return (public_key_der, signature, crx_id) for this payload."""
    if not os.path.isfile(key_path):
        subprocess.run(
            ["openssl", "genrsa", "-out", key_path, "2048"],
            check=True, capture_output=True,
        )
        os.chmod(key_path, 0o600)

    pub_der = os.path.join(workdir, "pub.der")
    subprocess.run(
        ["openssl", "rsa", "-in", key_path, "-pubout", "-outform", "DER", "-out", pub_der],
        check=True, capture_output=True,
    )
    public_key = open(pub_der, "rb").read()

    # The id is the first 16 bytes of the key digest, each nibble mapped into
    # a-p — Chromium's "mpdecimal" alphabet.
    digest = hashlib.sha256(public_key).digest()[:16]
    crx_id = "".join(chr(ord("a") + (b >> 4)) + chr(ord("a") + (b & 0xF)) for b in digest)

    signed_header_data = _field(1, digest)          # SignedData.crx_id
    zip_bytes = open(zip_path, "rb").read()

    payload = os.path.join(workdir, "payload.bin")
    with open(payload, "wb") as fh:
        fh.write(SIGNATURE_CONTEXT)
        fh.write(struct.pack("<I", len(signed_header_data)))
        fh.write(signed_header_data)
        fh.write(zip_bytes)

    sig_path = os.path.join(workdir, "sig.bin")
    subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path, "-out", sig_path, payload],
        check=True, capture_output=True,
    )
    signature = open(sig_path, "rb").read()

    return public_key, signature, crx_id, signed_header_data, zip_bytes


def write_crx(out_path, public_key, signature, signed_header_data, zip_bytes):
    proof = _field(1, public_key) + _field(2, signature)
    header = _field(2, proof) + _field(10000, signed_header_data)
    with open(out_path, "wb") as fh:
        fh.write(b"Cr24")
        fh.write(struct.pack("<II", 3, len(header)))
        fh.write(header)
        fh.write(zip_bytes)


def main(argv):
    if len(argv) < 5:
        print(__doc__)
        return 2
    src, dst, workdir, logo = argv[:4]
    pairs = []
    for spec in argv[4:]:
        old, _, new = spec.partition("=")
        pairs.append((old, new))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)

    os.makedirs(workdir, exist_ok=True)
    extracted = os.path.join(workdir, "ext")
    unpack(src, extracted)
    hits = rebrand(extracted, pairs, logo)

    zip_path = os.path.join(workdir, "payload.zip")
    make_zip(extracted, zip_path)

    key_path = os.path.join(workdir, "signing-key.pem")
    public_key, signature, crx_id, shd, zip_bytes = sign(zip_path, key_path, workdir)
    write_crx(dst, public_key, signature, shd, zip_bytes)

    print(crx_id)
    print(f"  {hits} strings rewritten", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
