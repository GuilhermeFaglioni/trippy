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
  UDID_A="$(xcrun simctl create "Trippy Roteiro A $(date +%s)" "$SIM_TYPE" "$SIM_RUNTIME")"
  UDID_B="$(xcrun simctl create "Trippy Roteiro B $(date +%s)" "$SIM_TYPE" "$SIM_RUNTIME")"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/trippy-roteiro-simuladores.XXXXXX")"
BUILD_DIR="$TMP_DIR/build"
API_PID=''
METRO_PID=''

log() {
  printf '[roteiro-dois-simuladores] %s\n' "$*"
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
  if [[ "${ROTEIRO_KEEP_TEMP:-0}" == 1 ]]; then
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
  if maestro test --test-output-dir "$artifacts_dir" --udid "$udid" "$ROOT_DIR/.maestro/roteiro/$flow" \
    "$@" >"$log_file" 2>&1; then
    sed -E 's/INVITE_TOKEN=.*/INVITE_TOKEN=[omitido]/' "$log_file"
  else
    sed -E 's/INVITE_TOKEN=.*/INVITE_TOKEN=[omitido]/' "$log_file" >&2
    return 1
  fi
}

psql_value() {
  docker exec trippy-postgres-1 psql -X -qAt -U trippy -d "$DATABASE_NAME" -c "$1"
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: esperado [%s], recebido [%s].\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
}

sqlite_order() {
  node --input-type=module - "$1" "$TRIP_ID" <<'NODE'
import { DatabaseSync } from 'node:sqlite'

const [databasePath, tripId] = process.argv.slice(2)
const database = new DatabaseSync(databasePath, { readOnly: true })
try {
  const places = database.prepare(`
    SELECT name FROM places
    WHERE trip_id = ? AND day_index = 0 AND deleted_at IS NULL
    ORDER BY position, id
  `).all(tripId)
  console.log(places.map(({ name }) => name).join('|'))
} finally {
  database.close()
}
NODE
}

DATABASE_NAME="${TRIPPY_DATABASE_NAME:-$(node --env-file-if-exists=.env --input-type=module -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))')}"
if [[ ! "$DATABASE_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf 'Nome de banco inválido em DATABASE_URL.\n' >&2
  exit 1
fi

log "Simulador A: $UDID_A"
log "Simulador B: $UDID_B"
log "Banco de validação: $DATABASE_NAME"
boot_simulator "$UDID_A"
boot_simulator "$UDID_B"

API_PORT="$(pick_port 4300)"
METRO_PORT="$(pick_port 4400)"
API_URL="http://localhost:$API_PORT"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
A_EMAIL="roteiro-a-$RUN_ID@example.test"
B_EMAIL="roteiro-b-$RUN_ID@example.test"
TRIP_NAME="Conflito roteiro $RUN_ID"
PLACE_1="Roteiro Alfa $RUN_ID"
PLACE_2="Roteiro Bravo $RUN_ID"
PLACE_3="Roteiro Charlie $RUN_ID"
PLACE_PENDENTE="Lugar pendente B $RUN_ID"
PLACE_1_SLUG="$(printf '%s' "$PLACE_1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
PLACE_2_SLUG="$(printf '%s' "$PLACE_2" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
PLACE_3_SLUG="$(printf '%s' "$PLACE_3" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
PLACE_PENDENTE_SLUG="$(printf '%s' "$PLACE_PENDENTE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

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
log 'Compilando development build iOS único para os dois Simulators.'
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

log 'A autentica, cria a viagem e gera convite pelo app.'
run_maestro "$UDID_A" a-cria-viagem-convite.yaml \
  -e "A_EMAIL=$A_EMAIL" -e "TRIP_NAME=$TRIP_NAME"
INVITE_CODE="$(rg --no-filename -o 'JsConsole: INVITE_TOKEN=[A-Za-z0-9_-]+' \
  "$TMP_DIR/maestro-a-cria-viagem-convite" --glob 'maestro.log' | sed -E 's/.*=//' | tail -n 1)"
if [[ ! "$INVITE_CODE" =~ ^[A-Za-z0-9_-]{40,}$ ]]; then
  printf 'Fluxo A não retornou um código de convite válido.\n' >&2
  exit 1
fi
TRIP_NAME_SQL="${TRIP_NAME//\'/\'\'}"
TRIP_ID="$(psql_value "SELECT id FROM trips WHERE name = '$TRIP_NAME_SQL' ORDER BY created_at DESC LIMIT 1")"
if [[ ! "$TRIP_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Não foi possível consultar a viagem criada pelo app A.\n' >&2
  exit 1
fi
A_USER_ID="$(psql_value "SELECT id FROM users WHERE email = '$A_EMAIL'")"
CONTAINER_A="$(xcrun simctl get_app_container "$UDID_A" app.trippy.mobile data)"
DB_A="$(find "$CONTAINER_A" -type f -name "trippy-$A_USER_ID.db" -print -quit)"
if [[ -z "$DB_A" ]]; then
  printf 'Banco SQLite A não encontrado no Simulator.\n' >&2
  exit 1
fi

log 'A adiciona três lugares e monta ordem inicial no primeiro dia.'
run_maestro "$UDID_A" a-prepara-roteiro.yaml \
  -e "TRIP_ID=$TRIP_ID" \
  -e "PLACE_1=$PLACE_1" -e "PLACE_1_SLUG=$PLACE_1_SLUG" \
  -e "PLACE_2=$PLACE_2" -e "PLACE_2_SLUG=$PLACE_2_SLUG" \
  -e "PLACE_3=$PLACE_3" -e "PLACE_3_SLUG=$PLACE_3_SLUG"
assert_equal "$(sqlite_order "$DB_A")" "$PLACE_1|$PLACE_2|$PLACE_3" 'Ordem inicial no SQLite A'
assert_equal "$(psql_value "SELECT string_agg(name, '|' ORDER BY position) FROM places WHERE trip_id = '$TRIP_ID' AND day_index = 0 AND deleted_at IS NULL")" \
  "$PLACE_1|$PLACE_2|$PLACE_3" 'Ordem inicial no Postgres'

log 'B autentica e entra pelo convite.'
run_maestro "$UDID_B" b-aceita-convite.yaml \
  -e "B_EMAIL=$B_EMAIL" -e "INVITE_CODE=$INVITE_CODE" -e "TRIP_NAME=$TRIP_NAME"
B_USER_ID="$(psql_value "SELECT id FROM users WHERE email = '$B_EMAIL'")"
if [[ ! "$B_USER_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Não foi possível consultar o usuário B no Postgres.\n' >&2
  exit 1
fi

log 'A promove B pelo Grupo.'
run_maestro "$UDID_A" a-promove-coorganizador.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "B_USER_ID=$B_USER_ID"
assert_equal "$(psql_value "SELECT role FROM trip_members WHERE trip_id = '$TRIP_ID' AND user_id = '$B_USER_ID' AND left_at IS NULL")" \
  'coorganizer' 'Papel de B no Postgres'

log 'A e B ativam Simular sem internet e reordenam o mesmo dia de formas diferentes.'
run_maestro "$UDID_A" a-offline-reordena.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_2_SLUG=$PLACE_2_SLUG"
run_maestro "$UDID_B" b-offline-reordena.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_3_SLUG=$PLACE_3_SLUG"
CONTAINER_B="$(xcrun simctl get_app_container "$UDID_B" app.trippy.mobile data)"
DB_B="$(find "$CONTAINER_B" -type f -name "trippy-$B_USER_ID.db" -print -quit)"
if [[ -z "$DB_B" ]]; then
  printf 'Banco SQLite B não encontrado no Simulator.\n' >&2
  exit 1
fi
assert_equal "$(sqlite_order "$DB_A")" "$PLACE_2|$PLACE_1|$PLACE_3" 'Rascunho local offline A'
assert_equal "$(sqlite_order "$DB_B")" "$PLACE_3|$PLACE_1|$PLACE_2" 'Rascunho local offline B'
assert_equal "$(psql_value "SELECT itinerary_version FROM trips WHERE id = '$TRIP_ID'")" \
  '0' 'Versão do servidor enquanto ambos estão offline'

log 'A reconecta; Postgres recebe a ordem A e avança uma versão.'
run_maestro "$UDID_A" a-reconecta.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_2_SLUG=$PLACE_2_SLUG"
assert_equal "$(psql_value "SELECT itinerary_version FROM trips WHERE id = '$TRIP_ID'")" \
  '1' 'Versão após sincronização A'
assert_equal "$(psql_value "SELECT string_agg(name, '|' ORDER BY position) FROM places WHERE trip_id = '$TRIP_ID' AND day_index = 0 AND deleted_at IS NULL")" \
  "$PLACE_2|$PLACE_1|$PLACE_3" 'Ordem vencedora A no Postgres'

log 'B reconecta; tela compara rascunho com roteiro atual e reaplica o rascunho.'
run_maestro "$UDID_B" b-reconecta-reaplica.yaml \
  -e "TRIP_ID=$TRIP_ID" \
  -e "PLACE_1_SLUG=$PLACE_1_SLUG" -e "PLACE_2_SLUG=$PLACE_2_SLUG" \
  -e "PLACE_3_SLUG=$PLACE_3_SLUG"
assert_equal "$(psql_value "SELECT itinerary_version FROM trips WHERE id = '$TRIP_ID'")" \
  '2' 'Versão após reaplicação B'
assert_equal "$(psql_value "SELECT string_agg(name, '|' ORDER BY position) FROM places WHERE trip_id = '$TRIP_ID' AND day_index = 0 AND deleted_at IS NULL")" \
  "$PLACE_3|$PLACE_1|$PLACE_2" 'Ordem após reaplicação B'

log 'B volta ao modo offline e adiciona lugar pendente.'
run_maestro "$UDID_B" b-offline-adiciona.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "PLACE_PENDENTE=$PLACE_PENDENTE" \
  -e "PLACE_PENDENTE_SLUG=$PLACE_PENDENTE_SLUG"

log 'A remove B pelo Grupo; B reconecta e vê viagem removida com uma pendência.'
run_maestro "$UDID_A" a-remove-b.yaml \
  -e "TRIP_ID=$TRIP_ID" -e "B_USER_ID=$B_USER_ID"
run_maestro "$UDID_B" b-reconecta-removido.yaml -e "TRIP_ID=$TRIP_ID"

log 'Comparando os bancos SQLite A/B com Postgres.'
node --input-type=module - "$DB_A" "$DB_B" "$TRIP_ID" "$PLACE_PENDENTE" "$DATABASE_NAME" "$B_USER_ID" "$PLACE_3|$PLACE_1|$PLACE_2" <<'NODE'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'

const [databaseAPath, databaseBPath, tripId, unsentPlaceName, databaseName, memberBId, expectedOrder] =
  process.argv.slice(2)

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
      SELECT trip_id AS tripId, user_id AS userId, role,
             joined_at AS joinedAt, seq, deleted_at AS deletedAt
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
  ['exec', 'trippy-postgres-1', 'psql', '-X', '-qAt', '-U', 'trippy', '-d', databaseName, '-c', sql],
  { encoding: 'utf8' },
).trim()
const server = JSON.parse(serverOutput)
for (const place of server.places) place.createdAt = iso(place.createdAt)
for (const visit of server.visits) visit.visitedAt = iso(visit.visitedAt)
for (const member of server.members) member.joinedAt = iso(member.joinedAt)

const stateA = canonicalSqlite(databaseAPath)
const stateB = canonicalSqlite(databaseBPath)
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(isDeepStrictEqual(stateA, server), 'SQLite A diverge do estado canônico do Postgres.')
assert(stateA.places.length === 3, `SQLite A deveria ter 3 lugares; recebeu ${stateA.places.length}.`)
assert(stateA.visits.length === 0, 'Cenário não deveria ter visitas.')
assert(stateA.members.length === 1, `SQLite A deveria ter 1 membro ativo; recebeu ${stateA.members.length}.`)
assert(stateB.places.length === 0, 'SQLite B removido ainda contém lugares ativos.')
assert(stateB.visits.length === 0, 'SQLite B removido ainda contém visitas ativas.')
assert(stateB.members.length === 0, 'SQLite B removido ainda contém membros ativos.')

const databaseB = new DatabaseSync(databaseBPath, { readOnly: true })
let localBState
let notSentCount
try {
  localBState = databaseB.prepare(`
    SELECT removed_at AS removedAt FROM sync_state WHERE trip_id = ?
  `).get(tripId)
  notSentCount = databaseB.prepare(`
    SELECT COUNT(*) AS count FROM outbox WHERE trip_id = ? AND status = 'not_sent'
  `).get(tripId).count
  const unsentPlace = databaseB.prepare('SELECT id FROM places WHERE trip_id = ? AND name = ?')
    .get(tripId, unsentPlaceName)
  assert(unsentPlace === undefined, 'Lugar pendente de B deveria ter sido removido da projeção local.')
} finally {
  databaseB.close()
}
assert(typeof localBState?.removedAt === 'string', 'SQLite B não registrou a viagem como removida.')
assert(Number(notSentCount) === 1, `SQLite B deveria manter 1 operação não enviada; recebeu ${notSentCount}.`)

const serverState = execFileSync(
  'docker',
  ['exec', 'trippy-postgres-1', 'psql', '-X', '-qAt', '-U', 'trippy', '-d', databaseName, '-c', `
    SELECT json_build_object(
      'version', (SELECT itinerary_version FROM trips WHERE id = '${tripId}'),
      'order', (SELECT json_agg(name ORDER BY position) FROM places
                WHERE trip_id = '${tripId}' AND day_index = 0 AND deleted_at IS NULL),
      'unsentPlaceCount', (SELECT COUNT(*) FROM places
                           WHERE trip_id = '${tripId}' AND name = '${unsentPlaceName}'),
      'activeMembers', (SELECT COUNT(*) FROM trip_members
                        WHERE trip_id = '${tripId}' AND left_at IS NULL),
      'removedB', (SELECT left_at IS NOT NULL FROM trip_members
                   WHERE trip_id = '${tripId}' AND user_id = '${memberBId}')
    )::text
  `],
  { encoding: 'utf8' },
).trim()
const finalServer = JSON.parse(serverState)
assert(Number(finalServer.version) === 2, `Versão final esperada 2; recebeu ${finalServer.version}.`)
assert(finalServer.order?.length === 3, 'Postgres deveria manter os três lugares da viagem.')
assert(finalServer.order.join('|') === expectedOrder, 'Ordem final do Postgres difere do rascunho reaplicado por B.')
assert(Number(finalServer.unsentPlaceCount) === 0, 'Postgres recebeu o lugar offline de B após sua remoção.')
assert(Number(finalServer.activeMembers) === 1, 'Postgres deveria manter somente A como membro ativo.')
assert(finalServer.removedB === true, 'Postgres não registrou B como removido.')

console.log(`SQLite A = Postgres: ${stateA.places.length} lugares, ${stateA.members.length} membro ativo.`)
console.log(`SQLite B: ${stateB.places.length} lugares, ${stateB.members.length} membros, ${notSentCount} operação não enviada, viagem removida.`)
console.log(`Postgres: versão ${finalServer.version}, ordem reaplicada, lugar pendente de B ausente.`)
NODE

log 'Cenário de conflito confirmado nos dois Simulators e no Postgres.'
