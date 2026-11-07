#!/usr/bin/env bash
# P7-N (docs/runs/p7-launch.md; lead's decision 2026-11-07): the envelope of the nightly production backup (.github/workflows/backup.yml).
#
#   bash scripts/backup-encrypt.sh <dump.sql> <public-key.pem> <out.tar>
#
# What it does (OpenSSL only, so the owner's PC needs nothing but Git for Windows to open it; scripts/backup-decrypt.ps1):
#   1. a fresh random key: 32 random bytes from `openssl rand`, written as 64 hex characters (the passphrase of step 2);
#   2. the dump is encrypted with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -md sha256` under that key;
#   3. the key is wrapped with the owner's RSA public key (at least 4096 bits) by `openssl pkeyutl -encrypt`, RSA-OAEP with SHA-256 (OAEP and MGF1);
#   4. one tar holds exactly `manifest.json`, `dump.sql.enc` and `key.bin.enc`. The manifest: the format version, the UTC time, the byte sizes, the
#      SHA-256 of the plaintext dump and of the public key (DER), so the owner can tell which key a backup needs.
# The plain key exists only in a private scratch folder next to <out.tar>, removed on every exit. The dump itself is left in place: the workflow
# deletes it in its own step. Nothing secret is printed. Paths: forward slashes (C:/... on Windows).
set -euo pipefail
umask 077

FORMAT="techaust-d1-backup/1"
ITER=200000
MIN_BITS=4096

fail() {
  echo "backup-encrypt: $*" >&2
  exit 1
}

[ "$#" -eq 3 ] || fail "usage: backup-encrypt.sh <dump.sql> <public-key.pem> <out.tar>"
dump="${1//\\//}"
pub="${2//\\//}"
out="${3//\\//}"

command -v openssl >/dev/null 2>&1 || fail "openssl is not installed."
command -v tar >/dev/null 2>&1 || fail "tar is not installed."
[ -f "$dump" ] || fail "the dump $dump does not exist."
[ -s "$dump" ] || fail "the dump $dump is empty."
[ -f "$pub" ] || fail "the public key $pub does not exist."
[ ! -e "$out" ] || fail "$out already exists; nothing was written."
case "$out" in
  *.tar) ;;
  *) fail "the output must end in .tar." ;;
esac

name="$(basename -- "$dump")"
[[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || fail "the dump's file name may hold only letters, digits, dot, dash and underscore."

# The wrapping key: RSA, at least 4096 bits (the owner's backup-public.pem).
bits="$(openssl rsa -pubin -in "$pub" -noout -text 2>/dev/null | sed -n 's/.*Public-Key: (\([0-9][0-9]*\) bit).*/\1/p' | head -n 1)"
[ -n "$bits" ] || fail "the public key is not an RSA public key in PEM form."
[ "$bits" -ge "$MIN_BITS" ] || fail "the public key has $bits bits; at least $MIN_BITS are needed."
pub_sha="$(openssl pkey -pubin -in "$pub" -outform DER | openssl dgst -sha256 -r | cut -d' ' -f1)"

work="$(mktemp -d "$(dirname -- "$out")/.techaust-backup.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

# 1. The key: 64 hex characters and one LF (`-pass stdin` and `-pass file:` read the first line). A Windows OpenSSL ends its output with CRLF, so the
#    line is rewritten with a bare LF.
printf '%s\n' "$(openssl rand -hex 32 | tr -d '\r\n')" >"$work/key.bin"
grep -Eq '^[0-9a-f]{64}$' "$work/key.bin" || fail "the key was not made."

# 2. The dump, encrypted (the key on standard input, never on a command line).
openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt -md sha256 -in "$dump" -out "$work/dump.sql.enc" -pass stdin <"$work/key.bin"

# 3. The key, wrapped for the owner's private key.
openssl pkeyutl -encrypt -pubin -inkey "$pub" \
  -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 \
  -in "$work/key.bin" -out "$work/key.bin.enc"
rm -f -- "$work/key.bin"

size() { wc -c <"$1" | tr -d ' '; }
plain_bytes="$(size "$dump")"
plain_sha="$(openssl dgst -sha256 -r "$dump" | cut -d' ' -f1)"
enc_bytes="$(size "$work/dump.sql.enc")"
key_bytes="$(size "$work/key.bin.enc")"
[ "$enc_bytes" -gt 0 ] && [ "$key_bytes" -gt 0 ] || fail "encryption wrote nothing."

# 4. The manifest (every value is a number, a hex string, a fixed word or the checked file name) and the tar, built inside the scratch folder.
cat >"$work/manifest.json" <<JSON
{
  "format": "$FORMAT",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plaintext": { "file": "$name", "bytes": $plain_bytes, "sha256": "$plain_sha" },
  "encrypted": { "file": "dump.sql.enc", "bytes": $enc_bytes, "cipher": "aes-256-cbc", "kdf": "pbkdf2", "iter": $ITER, "md": "sha256" },
  "key": { "file": "key.bin.enc", "bytes": $key_bytes, "wrap": "rsa-oaep", "oaepMd": "sha256", "mgf1Md": "sha256", "publicKeySha256": "$pub_sha" }
}
JSON
(cd "$work" && tar -cf archive.tar manifest.json dump.sql.enc key.bin.enc)
mv -- "$work/archive.tar" "$out"

echo "backup-encrypt: wrote $(basename -- "$out") ($(size "$out") bytes; plaintext $plain_bytes bytes, SHA-256 $plain_sha; public key SHA-256 $pub_sha)."
