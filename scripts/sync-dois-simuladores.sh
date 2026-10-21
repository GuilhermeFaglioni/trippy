#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if (( $# != 0 && $# != 2 )); then
  printf 'Uso: %s [UDID_A UDID_B]\n' "$0" >&2
  exit 2
fi

if (( $# == 2 )); then
  UDID_A="$1"
  UDID_B="$2"
else
  SIM_RUNTIME="${SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-18-4}"
  SIM_TYPE="${SIM_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro}"
  UDID_A="$(xcrun simctl create "Trippy Sync A $(date +%s)" "$SIM_TYPE" "$SIM_RUNTIME")"
  UDID_B="$(xcrun simctl create "Trippy Sync B $(date +%s)" "$SIM_TYPE" "$SIM_RUNTIME")"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/trippy-sync-simuladores.XXXXXX")"
BUILD_DIR="$TMP_DIR/build"
API_PID=''
METRO_PID=''

log() {
  printf '[sync-dois-simuladores] %s\n' "$*"
}

cleanup() {
  if [[ -n "$METRO_PID" ]]; then
    kill "$METRO_PID" >/dev/null 2>&1 || true
    wait "$METRO_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
  if [[ "${SYNC_KEEP_TEMP:-0}" == 1 ]]; then
    log "Artefatos preservados em $TMP_DIR"
  else
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

pick_port() {
  local first="$1"
  local last=$(( first + 99 ))
  local port
  for port in $(seq "$first" "$last"); do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf '%s' "$port"
      return 0
    fi
  done
  return 1
}

wait_for_http() {
  local url="$1"
  local pid="$2"
  local log_file="$3"
  local attempt
  for attempt in $(seq 1 90); do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      cat "$log_file" >&2
      return 1
    fi
    sleep 1
  done
  cat "$log_file" >&2
  printf 'Timeout aguardando %s\n' "$url" >&2
  return 1
}

boot_simulator() {
  local udid="$1"
  if ! xcrun simctl list devices available | rg -F "$udid" | rg -q 'Booted'; then
    xcrun simctl boot "$udid"
  fi
  xcrun simctl bootstatus "$udid" -b
}

run_maestro() {
  local udid="$1"
  local flow="$2"
  local log_file="$TMP_DIR/$(basename "$flow" .yaml).log"
  local artifacts_dir="$TMP_DIR/maestro-$(basename "$flow" .yaml)"
  shift 2
  if maestro test --test-output-dir "$artifacts_dir" --udid "$udid" "$ROOT_DIR/.maestro/sync/$flow" \
    "$@" >"$log_file" 2>&1; then
    sed -E 's/INVITE_TOKEN=.*/INVITE_TOKEN=[omitido]/' "$log_file"
  else
    sed -E 's/INVITE_TOKEN=.*/INVITE_TOKEN=[omitido]/' "$log_file" >&2
    return 1
  fi
}

psql_value() {
  docker exec trippy-postgres-1 psql -X -qAt -U trippy -d trippy_w23 -c "$1"
}

log "Simulador A: $UDID_A"
log "Simulador B: $UDID_B"
boot_simulator "$UDID_A"
boot_simulator "$UDID_B"

API_PORT="$(pick_port 4300)"
METRO_PORT="$(pick_port 4400)"
API_URL="http://localhost:$API_PORT"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
A_EMAIL="sync-a-$RUN_ID@example.test"
B_EMAIL="sync-b-$RUN_ID@example.test"
TRIP_NAME="Sync Offline $RUN_ID"
PLACE_NAME="Lugar Offline $RUN_ID"
PLACE_SLUG="$(printf '%s' "$PLACE_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

log "API local: $API_URL"
log "Metro: porta $METRO_PORT"
(
  cd "$ROOT_DIR/apps/api"
  PORT="$API_PORT" node --env-file-if-exists=../../.env --import tsx src/server.ts
) >"$TMP_DIR/api.log" 2>&1 &
API_PID=$!
wait_for_http "$API_URL/health" "$API_PID" "$TMP_DIR/api.log"

(
  cd "$ROOT_DIR/apps/mobile"
  CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL="$API_URL" \
    ./node_modules/.bin/expo start --port "$METRO_PORT" --localhost
) >"$TMP_DIR/metro.log" 2>&1 &
METRO_PID=$!
wait_for_http "http://localhost:$METRO_PORT/status" "$METRO_PID" "$TMP_DIR/metro.log"

mkdir -p "$BUILD_DIR"
log 'Compilando um development build iOS para instalar o mesmo artefato nos dois simuladores.'
if ! (
  cd "$ROOT_DIR/apps/mobile"
  EXPO_PUBLIC_API_URL="$API_URL" ./node_modules/.bin/expo run:ios \
    --device generic --no-bundler --output "$BUILD_DIR"
) >"$TMP_DIR/build.log" 2>&1; then
  cat "$TMP_DIR/build.log" >&2
  exit 1
fi
APP_PATH="$(find "$BUILD_DIR" -maxdepth 5 -type d -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  cat "$TMP_DIR/build.log" >&2
  printf 'Expo não produziu um bundle .app em %s\n' "$BUILD_DIR" >&2
  exit 1
fi
log "Build: $APP_PATH"
xcrun simctl uninstall "$UDID_A" app.trippy.mobile >/dev/null 2>&1 || true
xcrun simctl uninstall "$UDID_B" app.trippy.mobile >/dev/null 2>&1 || true
xcrun simctl install "$UDID_A" "$APP_PATH"
xcrun simctl install "$UDID_B" "$APP_PATH"
xcrun simctl spawn "$UDID_A" defaults write app.trippy.mobile RCT_jsLocation "localhost:$METRO_PORT"
xcrun simctl spawn "$UDID_B" defaults write app.trippy.mobile RCT_jsLocation "localhost:$METRO_PORT"

TRIP_NAME_SQL="${TRIP_NAME//\'/\'\'}"
log 'Executando login, criação da viagem e geração do convite pelo app A.'
run_maestro "$UDID_A" a-cria-viagem-convite.yaml \
  -e "A_EMAIL=$A_EMAIL" -e "TRIP_NAME=$TRIP_NAME"
INVITE_CODE="$(rg --no-filename -o 'JsConsole: INVITE_TOKEN=[A-Za-z0-9_-]+' \
  "$TMP_DIR/maestro-a-cria-viagem-convite" --glob 'maestro.log' | sed -E 's/.*=//' | tail -n 1)"
if [[ ! "$INVITE_CODE" =~ ^[A-Za-z0-9_-]{40,}$ ]]; then
  printf 'Fluxo A não retornou código de convite válido.\n' >&2
  exit 1
fi
TRIP_ID="$(psql_value "SELECT id FROM trips WHERE name = '$TRIP_NAME_SQL' ORDER BY created_at DESC LIMIT 1")"
if [[ ! "$TRIP_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Não foi possível consultar a viagem criada pelo app A.\n' >&2
  exit 1
fi

log 'Executando login e aceite do convite pelo app B.'
run_maestro "$UDID_B" b-aceita-convite.yaml \
  -e "B_EMAIL=$B_EMAIL" -e "INVITE_CODE=$INVITE_CODE" -e "TRIP_NAME=$TRIP_NAME"

log 'Ativando modo offline em A, escrevendo, encerrando o app e reabrindo o mesmo SQLite.'
run_maestro "$UDID_A" a-offline-reabre.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_NAME=$PLACE_NAME" -e "PLACE_SLUG=$PLACE_SLUG"
SERVER_PLACE_COUNT="$(psql_value "SELECT count(*) FROM places WHERE trip_id = '$TRIP_ID' AND name = '$PLACE_NAME'")"
if [[ "$SERVER_PLACE_COUNT" != 0 ]]; then
  printf 'Lugar offline já apareceu no servidor antes da reconexão (count=%s).\n' "$SERVER_PLACE_COUNT" >&2
  exit 1
fi
log 'Com A ainda offline, Postgres confirma que lugar não foi enviado.'

log 'Reconectando A e aguardando o outbox esvaziar.'
run_maestro "$UDID_A" a-reconecta.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_NAME=$PLACE_NAME"
log 'Fechando e reabrindo B para sincronizar a atualização de A.'
run_maestro "$UDID_B" b-sincroniza.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_NAME=$PLACE_NAME" -e "PLACE_SLUG=$PLACE_SLUG"

A_USER_ID="$(psql_value "SELECT id FROM users WHERE email = '$A_EMAIL'")"
B_USER_ID="$(psql_value "SELECT id FROM users WHERE email = '$B_EMAIL'")"
CONTAINER_A="$(xcrun simctl get_app_container "$UDID_A" app.trippy.mobile data)"
CONTAINER_B="$(xcrun simctl get_app_container "$UDID_B" app.trippy.mobile data)"
DB_A="$(find "$CONTAINER_A" -type f -name "trippy-$A_USER_ID.db" -print -quit)"
DB_B="$(find "$CONTAINER_B" -type f -name "trippy-$B_USER_ID.db" -print -quit)"
if [[ -z "$DB_A" || -z "$DB_B" ]]; then
  printf 'Banco SQLite não encontrado nos containers dos Simulators.\nA=%s\nB=%s\n' "$DB_A" "$DB_B" >&2
  exit 1
fi

node --input-type=module - "$DB_A" "$DB_B" "$TRIP_ID" <<'NODE'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

const [databaseAPath, databaseBPath, tripId] = process.argv.slice(2)

function iso(value) {
  return value === null ? null : new Date(value).toISOString()
}

function canonicalSqlite(path) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const places = database.prepare(`
      SELECT id, trip_id AS tripId, provider, provider_ref AS providerRef, name,
             local_name AS localName, address, local_address AS localAddress, lat, lng,
             suggested_by AS suggestedBy, comment, day_index AS dayIndex, position, seq,
             deleted_at AS deletedAt, created_at AS createdAt
      FROM places WHERE trip_id = ? AND deleted_at IS NULL ORDER BY id
    `).all(tripId)
    const visits = database.prepare(`
      SELECT place_id AS placeId, trip_id AS tripId, user_id AS userId,
             marked_by AS markedBy, visited_at AS visitedAt, visited_tz AS visitedTz,
             seq, deleted_at AS deletedAt
      FROM visits WHERE trip_id = ? AND deleted_at IS NULL ORDER BY place_id, user_id
    `).all(tripId)
    const members = database.prepare(`
      SELECT trip_id AS tripId, user_id AS userId, role, joined_at AS joinedAt,
             seq, deleted_at AS deletedAt
      FROM members WHERE trip_id = ? AND deleted_at IS NULL ORDER BY user_id
    `).all(tripId)
    return {
      places: places.map((place) => ({ ...place, createdAt: iso(place.createdAt) })),
      visits: visits.map((visit) => ({ ...visit, visitedAt: iso(visit.visitedAt) })),
      members: members.map((member) => ({ ...member, joinedAt: iso(member.joinedAt) })),
    }
  } finally {
    database.close()
  }
}

const sql = `
  SELECT json_build_object(
    'places', COALESCE((
      SELECT json_agg(json_build_object(
        'id', id, 'tripId', trip_id, 'provider', provider, 'providerRef', provider_ref,
        'name', name, 'localName', local_name, 'address', address,
        'localAddress', local_address, 'lat', lat, 'lng', lng,
        'suggestedBy', suggested_by, 'comment', comment, 'dayIndex', day_index,
        'position', position, 'seq', seq::text, 'deletedAt', NULL,
        'createdAt', created_at::text
      ) ORDER BY id)
      FROM places WHERE trip_id = '${tripId}' AND deleted_at IS NULL
    ), '[]'::json),
    'visits', COALESCE((
      SELECT json_agg(json_build_object(
        'placeId', place_id, 'tripId', trip_id, 'userId', user_id,
        'markedBy', marked_by, 'visitedAt', visited_at::text, 'visitedTz', visited_tz,
        'seq', seq::text, 'deletedAt', NULL
      ) ORDER BY place_id, user_id)
      FROM visits WHERE trip_id = '${tripId}' AND deleted_at IS NULL
    ), '[]'::json),
    'members', COALESCE((
      SELECT json_agg(json_build_object(
        'tripId', trip_id, 'userId', user_id, 'role', role,
        'joinedAt', joined_at::text, 'seq', seq::text, 'deletedAt', NULL
      ) ORDER BY user_id)
      FROM trip_members WHERE trip_id = '${tripId}' AND left_at IS NULL
    ), '[]'::json)
  )::text
`

const serverOutput = execFileSync(
  'docker',
  ['exec', 'trippy-postgres-1', 'psql', '-X', '-qAt', '-U', 'trippy', '-d', 'trippy_w23', '-c', sql],
  { encoding: 'utf8' },
).trim()
const server = JSON.parse(serverOutput)
for (const place of server.places) place.createdAt = iso(place.createdAt)
for (const visit of server.visits) visit.visitedAt = iso(visit.visitedAt)
for (const member of server.members) member.joinedAt = iso(member.joinedAt)

const stateA = canonicalSqlite(databaseAPath)
const stateB = canonicalSqlite(databaseBPath)
if (!isDeepStrictEqual(stateA, stateB) || !isDeepStrictEqual(stateA, server)) {
  console.error(JSON.stringify({ stateA, stateB, server }, null, 2))
  process.exitCode = 1
} else {
  console.log(
    `Estados canônicos iguais: ${stateA.places.length} lugares, ${stateA.visits.length} visitas, ${stateA.members.length} membros.`,
  )
}
NODE

log 'Convergência confirmada entre SQLite A, SQLite B e Postgres.'
