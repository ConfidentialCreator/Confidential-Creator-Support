#!/usr/bin/env bash
# Builds the on-chain part in WSL from a repository that lives on a Windows drive.
#
# Call from PowerShell, not from Git Bash:
#   wsl.exe -e bash /mnt/<drive>/<path to repo>/scripts/wsl-build.sh <command>
#
# 1. Git Bash rewrites an argument of the form /mnt/<drive>/... into a Windows path
#    before wsl ever sees it — hence the call goes through PowerShell.
# 2. The script is passed as a file, not as a string via `bash -c`: quotes and
#    dollars in a string go through two layers of interpretation.
# 3. PATH is set explicitly: a non-interactive shell does not read ~/.profile.

set -euo pipefail

export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.build.log"
CMD="${1:-build-sbf}"
PROGRAM=ccsupport
SO="target/deploy/ccsupport.so"
# The program key lives outside the repository: in the WSL home folder by default,
# elsewhere through the environment variable.
KEYS="${CCS_PROGRAM_KEYPAIR:-$HOME/.config/ccsupport/ccsupport-keypair.json}"

cd "$ROOT"

# All output goes to a file from inside the script: the cargo progress bar rewrites
# the line with a carriage return, and with an outer redirect the cause of a
# failure does not survive in the file.
run() {
  echo "── $* ──" >>"$LOG"
  if ! "$@" >>"$LOG" 2>&1; then
    echo "ERROR: $*"
    echo "── last 40 lines of $LOG ──"
    tail -40 "$LOG"
    exit 1
  fi
}

# `anchor build` without the key would generate a new one and silently diverge from declare_id!.
sync_keypair() {
  mkdir -p target/deploy
  if [[ -f "$KEYS" ]]; then
    cp "$KEYS" target/deploy/ccsupport-keypair.json
  fi
}

# The artifact for the network is SBPFv0. `anchor build` writes v3 (`e_flags = 3`), which
# Agave 3.1.10 does not run; the header is checked instead of trusting the build command.
check_v0() {
  local flags
  flags="$(readelf -h "$SO" | awk '/Flags:/ {print $2}')"
  if [[ "$flags" != "0x0" ]]; then
    echo "ERROR: $SO has e_flags=$flags, expected 0x0 (SBPFv0)"
    exit 1
  fi
}

# The `try_accounts` frame under v0 is 4 KiB, and the build reports it as a line, not an error.
check_frame() {
  if grep -qE 'overwrites values in the frame|exceeded max offset' "$LOG"; then
    echo "ERROR: stack frame overflow (see $LOG):"
    grep -E 'overwrites values in the frame|exceeded max offset' "$LOG" | head -5
    exit 1
  fi
}

: >"$LOG"

echo "anchor:  $(anchor --version)"
echo "solana:  $(solana --version)"
echo "sbf:     $(cargo-build-sbf --version | head -1)"
echo "log:     $LOG"
echo

case "$CMD" in
  build-sbf)
    # cargo-build-sbf without a key in target/deploy generates a random one — and the
    # deploy would not go under declare_id!.
    sync_keypair
    run cargo-build-sbf --manifest-path "programs/$PROGRAM/Cargo.toml"
    check_frame
    check_v0
    echo "OK — $SO: $(stat -c %s "$SO") bytes, SBPFv0"
    ;;
  idl)
    sync_keypair
    run anchor build
    echo "OK — IDL in target/idl/ccsupport.json"
    echo "WARNING: anchor build overwrote $SO with a v3 artifact — before test/deploy: $0 build-sbf"
    ;;
  build)
    # anchor build writes v3 into the same target/deploy — the SBF build goes last.
    "$0" idl
    "$0" build-sbf
    ;;
  fmt)
    run cargo fmt --all
    echo "OK — formatted"
    ;;
  fmt-check)
    run cargo fmt --all --check
    echo "OK — format clean"
    ;;
  clippy)
    run cargo clippy --workspace --all-targets -- -D warnings
    echo "OK — clippy clean"
    ;;
  test)
    if [[ ! -f "$SO" ]]; then
      echo "no $SO — first: $0 build-sbf" >&2
      exit 1
    fi
    check_v0
    run cargo test --workspace
    echo "OK — tests passed"
    ;;
  gate)
    "$0" fmt-check
    "$0" clippy
    "$0" build-sbf
    "$0" test
    ;;
  *)
    echo "unknown command: $CMD (build-sbf | idl | build | fmt | fmt-check | clippy | test | gate)" >&2
    exit 2
    ;;
esac
