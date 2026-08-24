#!/usr/bin/env bash

# Install the Codex hook client and manifest into a target project. The API key
# is read silently and written only to the ignored project config file.
set -u

REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$PWD"
API_URL=''

usage() {
  printf '%s\n' 'Usage: bash scripts/install-hook.sh [--project-root DIR] [--api-url URL]'
  printf '%s\n' 'The project root defaults to the current working directory.'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root)
      if [[ $# -lt 2 ]]; then
        printf '%s\n' '--project-root requires a directory.' >&2
        usage >&2
        exit 1
      fi
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --api-url)
      if [[ $# -lt 2 ]]; then
        printf '%s\n' '--api-url requires a URL.' >&2
        usage >&2
        exit 1
      fi
      API_URL="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$API_URL" ]]; then
        printf '%s\n' "Unknown argument: $1" >&2
        usage >&2
        exit 1
      fi
      API_URL="$1"
      shift
      ;;
  esac
done

if [[ "$PROJECT_ROOT" == *:*\\* ]] && command -v cygpath >/dev/null 2>&1; then
  PROJECT_ROOT="$(cygpath -u "$PROJECT_ROOT")"
fi
if ! PROJECT_ROOT="$(cd -- "$PROJECT_ROOT" && pwd)"; then
  printf '%s\n' 'Cannot resolve the target project directory.' >&2
  exit 1
fi

if [[ -z "$API_URL" ]]; then
  read -r -p 'Nala Trace ingest URL [http://127.0.0.1:3003/ingest]: ' API_URL
fi
if [[ -z "$API_URL" ]]; then
  API_URL='http://127.0.0.1:3003/ingest'
fi

printf 'Nala Labs API key: '
IFS= read -r -s API_TOKEN
printf '\n'
if [[ -z "$API_TOKEN" ]]; then
  printf '%s\n' 'The API key cannot be empty.' >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  printf '%s\n' 'Go is required to build hook-client.' >&2
  exit 1
fi

CONFIG_DIR="$PROJECT_ROOT/.codex"
CONFIG_FILE="$CONFIG_DIR/nala-trace.env"
CONFIG_TEMP="$CONFIG_FILE.tmp.$$"
MANIFEST_SOURCE="$REPOSITORY_ROOT/hooks.json"
MANIFEST_FILE="$CONFIG_DIR/hooks.json"
MANIFEST_TEMP="$MANIFEST_FILE.tmp.$$"
SOURCE_CLIENT="$REPOSITORY_ROOT/backend/bin/hook-client.exe"
CLIENT_FILE="$CONFIG_DIR/hook-client.exe"
CLIENT_TEMP="$CLIENT_FILE.tmp.$$"
mkdir -p "$CONFIG_DIR"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot create $CONFIG_DIR." >&2
  exit 1
fi

umask 077
{
  printf 'CODEX_TRACE_API_URL=%s\n' "$API_URL"
  printf 'CODEX_TRACE_API_TOKEN=%s\n' "$API_TOKEN"
  printf 'CODEX_TRACE_API_TIMEOUT=2s\n'
} >"$CONFIG_TEMP"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot write $CONFIG_TEMP." >&2
  rm -f -- "$CONFIG_TEMP"
  exit 1
fi
mv -f -- "$CONFIG_TEMP" "$CONFIG_FILE"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot install $CONFIG_FILE." >&2
  rm -f -- "$CONFIG_TEMP"
  exit 1
fi

mkdir -p "$REPOSITORY_ROOT/backend/bin"
pushd "$REPOSITORY_ROOT/backend" >/dev/null
go build -o "$REPOSITORY_ROOT/backend/bin/hook-client.exe" ./cmd/hook-client
BUILD_STATUS=$?
popd >/dev/null
if [[ $BUILD_STATUS -ne 0 ]]; then
  printf '%s\n' 'hook-client build failed; the configuration file was written.' >&2
  exit 1
fi

cp -- "$SOURCE_CLIENT" "$CLIENT_TEMP"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot stage $CLIENT_FILE." >&2
  rm -f -- "$CLIENT_TEMP"
  exit 1
fi
chmod u=rwx,go= "$CLIENT_TEMP"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot set permissions on $CLIENT_FILE." >&2
  rm -f -- "$CLIENT_TEMP"
  exit 1
fi
mv -f -- "$CLIENT_TEMP" "$CLIENT_FILE"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot install $CLIENT_FILE." >&2
  rm -f -- "$CLIENT_TEMP"
  exit 1
fi

if [[ ! -f "$MANIFEST_SOURCE" ]]; then
  printf '%s\n' "Cannot find $MANIFEST_SOURCE." >&2
  exit 1
fi
cp -- "$MANIFEST_SOURCE" "$MANIFEST_TEMP"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot stage $MANIFEST_FILE." >&2
  rm -f -- "$MANIFEST_TEMP"
  exit 1
fi
mv -f -- "$MANIFEST_TEMP" "$MANIFEST_FILE"
if [[ $? -ne 0 ]]; then
  printf '%s\n' "Cannot install $MANIFEST_FILE." >&2
  rm -f -- "$MANIFEST_TEMP"
  exit 1
fi

printf '%s\n' 'Nala Trace hook installed.'
printf '%s\n' "Project root: $PROJECT_ROOT"
printf '%s\n' "Project config: $CONFIG_FILE"
printf '%s\n' "Project hooks: $MANIFEST_FILE"
printf '%s\n' "Project client: $CLIENT_FILE"
printf '%s\n' 'The hook client reads this file on every invocation; no environment restart is required.'
