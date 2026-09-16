#!/usr/bin/env bash
# Deploys and verifies the program on devnet from WSL. Call from PowerShell (see wsl-build.sh):
#   wsl.exe -e bash /mnt/<drive>/<path to repo>/scripts/wsl-deploy.sh <deploy|verify|status>
#
# deploy  — uploads target/deploy/ccsupport.so (SBPFv0 only) under the program's declare_id!;
#           the upgrade authority is a separate key outside the repo, created on demand.
# verify  — the bytecode on chain equals the local .so byte for byte and has e_flags 0x0.
# status  — `solana program show` + the deployer balance.
#
# RPC — SOLANA_RPC_URL from the root .env (Helius; the public devnet cuts a deploy off
# at hundreds of transactions), otherwise the public devnet.

set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.build.log"
CMD="${1:-status}"
SO="$ROOT/target/deploy/ccsupport.so"
KEYS_DIR="${CCS_KEYS_DIR:-$HOME/.config/ccsupport}"
PROGRAM_KEYPAIR="${CCS_PROGRAM_KEYPAIR:-$KEYS_DIR/ccsupport-keypair.json}"
DEPLOYER="${CCS_DEPLOYER_KEYPAIR:-$KEYS_DIR/devnet-deployer.json}"

url_from_env() {
  if [[ -f "$ROOT/.env" ]]; then
    sed -n 's/^SOLANA_RPC_URL=//p' "$ROOT/.env" | head -1 | tr -d '\r'
  fi
}
URL="${SOLANA_RPC_URL:-$(url_from_env)}"
URL="${URL:-devnet}"
# The Helius key sits in the query string — only the host goes to the output.
URL_SHOWN="$(printf '%s' "$URL" | sed 's#\(https\?://[^/?]*\).*#\1#')"

cd "$ROOT"

run() {
  echo "── $* ──" >>"$LOG"
  if ! "$@" >>"$LOG" 2>&1; then
    echo "ERROR: ${*//$URL/$URL_SHOWN}"
    echo "── last 40 lines of $LOG ──"
    tail -40 "$LOG" | sed "s#$URL#$URL_SHOWN#g"
    exit 1
  fi
}

check_v0() {
  local so="$1" flags
  flags="$(readelf -h "$so" | awk '/Flags:/ {print $2}')"
  if [[ "$flags" != "0x0" ]]; then
    echo "ERROR: $so has e_flags=$flags, expected 0x0 (SBPFv0) — run wsl-build.sh build-sbf first"
    exit 1
  fi
}

require_program_keypair() {
  if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
    echo "program key $PROGRAM_KEYPAIR is missing (restore it from the operator backup)" >&2
    exit 1
  fi
}

# The deployer is not id.json: id.json is shared by every project on this machine, and
# the upgrade authority should live next to the rest of the project keys.
ensure_deployer() {
  if [[ ! -f "$DEPLOYER" ]]; then
    mkdir -p "$(dirname "$DEPLOYER")"
    run solana-keygen new --no-bip39-passphrase --silent --outfile "$DEPLOYER"
    echo "created deployer $DEPLOYER"
  fi
}

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR" 2>/dev/null || echo 8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z)"

: >"$LOG"
echo "solana:   $(solana --version)"
echo "rpc:      $URL_SHOWN"
echo "program:  $PROGRAM_ID"
echo "log:      $LOG"
echo

case "$CMD" in
  deploy)
    require_program_keypair
    ensure_deployer
    check_v0 "$SO"
    size="$(stat -c %s "$SO")"
    # Room for upgrades: ProgramData fixes the length for the whole life of the program.
    max_len=$(( size * 3 / 2 ))
    rent="$(solana rent "$max_len" --url "$URL" --output json | sed -n 's/.*"rentExemptMinimumLamports": *\([0-9]*\).*/\1/p')"
    balance="$(solana balance "$(solana-keygen pubkey "$DEPLOYER")" --url "$URL" --lamports | awk '{print $1}')"
    echo "deployer: $(solana-keygen pubkey "$DEPLOYER")  $(( balance / 1000000 ))e-3 SOL"
    echo ".so:      $size bytes, max-len $max_len, ProgramData rent ≈ $(( rent / 1000000 ))e-3 SOL (+ the same again temporarily for the buffer)"
    if (( balance < rent * 2 + 100000000 )); then
      echo "ERROR: not enough SOL on the deployer — top up: solana airdrop 5 $(solana-keygen pubkey "$DEPLOYER") --url devnet"
      exit 1
    fi
    run solana program deploy "$SO" \
      --program-id "$PROGRAM_KEYPAIR" \
      --upgrade-authority "$DEPLOYER" \
      --keypair "$DEPLOYER" \
      --max-len "$max_len" \
      --url "$URL" \
      --commitment confirmed
    echo "OK — deployed $PROGRAM_ID"
    "$0" verify
    ;;
  verify)
    check_v0 "$SO"
    dump="$(mktemp --suffix=.so)"
    run solana program dump "$PROGRAM_ID" "$dump" --url "$URL"
    size="$(stat -c %s "$SO")"
    # The dump is the whole ProgramData: zeros follow the .so up to max-len.
    if ! cmp -s -n "$size" "$SO" "$dump"; then
      echo "ERROR: the bytecode on chain differs from $SO"
      rm -f "$dump"
      exit 1
    fi
    if tail -c +"$((size + 1))" "$dump" | tr -d '\0' | grep -q .; then
      echo "ERROR: ProgramData is not all zeros beyond $size bytes"
      rm -f "$dump"
      exit 1
    fi
    check_v0 "$dump"
    rm -f "$dump"
    echo "OK — bytecode on chain = $SO ($size bytes), SBPFv0"
    ;;
  status)
    if ! solana program show "$PROGRAM_ID" --url "$URL" 2>/dev/null | sed "s#$URL#$URL_SHOWN#g"; then
      echo "program $PROGRAM_ID is not on chain — $0 deploy"
    fi
    if [[ -f "$DEPLOYER" ]]; then
      echo "deployer: $(solana-keygen pubkey "$DEPLOYER")  $(solana balance "$(solana-keygen pubkey "$DEPLOYER")" --url "$URL")"
    else
      echo "deployer: not created yet ($DEPLOYER)"
    fi
    ;;
  *)
    echo "usage: $0 <deploy|verify|status>" >&2
    exit 2
    ;;
esac
