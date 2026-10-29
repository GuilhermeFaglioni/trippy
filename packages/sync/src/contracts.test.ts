import { describe, expect, it } from 'vitest'
import { canonicalTripState } from './canonical-state.ts'
import {
  isSyncSequence,
  isTripRole,
  isUuid,
  validateAcceptInviteRequest,
  validateCreateInviteParams,
  validateCreateInviteResponse,
  validatePullQuery,
  validatePullResponse,
  validatePushRequest,
  validatePushResponse,
  validateSyncOperation,
} from './validation.ts'
import { RECAP_SHARING_TERMS_VERSION } from './types.ts'
import type { SyncMember, SyncPlace, SyncReview, SyncVisit, SyncWant } from './types.ts'

const tripId = '58f75ed5-b524-46f8-b387-650d9b43ee36'
const userId = '3c42531a-085f-4ebc-89ca-d32dd33bc527'
const otherUserId = 'd109e726-e366-4c6a-b852-d33650af093b'
const placeId = '7ca841f4-1ceb-4597-b021-fbb3f80c5f9f'
const secondPlaceId = 'd79c4c77-534c-4c0a-b4e4-06f4e8ec44ca'
const opId = '88362a44-f59f-437e-a682-79966a68650a'
const candidate = {
  provider: 'geoapify' as const,
  providerRef: 'geo-123',
  name: 'Museu do Amanhã',
  localName: null,
  address: 'Praça Mauá, 1',
  localAddress: 'Praça Mauá, 1',
  lat: -22.894,
  lng: -43.179,
  countryCode: 'br',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding' as const,
  token: 'assinatura',
}

describe('validação das operações e do push', () => {
  it('valida UUID e sequência bigint em formato seguro para JSON', () => {
    expect(isUuid(opId)).toBe(true)
    expect(isUuid('não-é-uuid')).toBe(false)
    expect(isSyncSequence('9223372036854775807')).toBe(true)
    expect(isSyncSequence('9223372036854775808')).toBe(false)
    expect(isSyncSequence('01')).toBe(false)
    expect(isTripRole('organizer')).toBe(true)
    expect(isTripRole('unknown')).toBe(false)
  })

  it('normaliza o nome de place.add e mantém os metadados', () => {
    expect(
      validateSyncOperation({
        type: 'place.add',
        opId,
        tripId,
        placeId,
        name: '  Museu do Amanhã  ',
      }),
    ).toEqual({
      success: true,
      value: { type: 'place.add', opId, tripId, placeId, name: 'Museu do Amanhã' },
    })
  })

  it('aceita dayIndex opcional em place.add e recusa índices fora de 0..365', () => {
    const base = { type: 'place.add', opId, tripId, placeId, name: 'Museu do Amanhã' }
    const withDay = validateSyncOperation({ ...base, dayIndex: 365 })
    expect(withDay).toEqual({ success: true, value: { ...base, dayIndex: 365 } })

    const withoutDay = validateSyncOperation(base)
    expect(withoutDay).toEqual({ success: true, value: base })
    expect(withoutDay.success && 'dayIndex' in withoutDay.value).toBe(false)

    for (const dayIndex of [-1, 366, 1.5, '1', null]) {
      expect(validateSyncOperation({ ...base, dayIndex })).toEqual({
        success: false,
        issues: [{ path: 'dayIndex', message: 'Informe um índice de dia entre 0 e 365.' }],
      })
    }
  })

  it('aceita candidate assinado dentro de place.add', () => {
    expect(
      validateSyncOperation({
        type: 'place.add',
        opId,
        tripId,
        placeId,
        name: candidate.name,
        candidate,
      }),
    ).toEqual({
      success: true,
      value: { type: 'place.add', opId, tripId, placeId, name: candidate.name, candidate },
    })
  })

  it('valida place.google_link e rejeita IDs com espaços ou URL', () => {
    expect(
      validateSyncOperation({
        type: 'place.google_link',
        opId,
        tripId,
        placeId,
        googlePlaceId: 'ChIJgUbEo8cfqokR5lP9_Wh_DaM',
      }),
    ).toMatchObject({ success: true })
    expect(
      validateSyncOperation({
        type: 'place.google_link',
        opId,
        tripId,
        placeId,
        googlePlaceId: null,
      }),
    ).toMatchObject({ success: true })
    expect(
      validateSyncOperation({
        type: 'place.google_link',
        opId,
        tripId,
        placeId,
        googlePlaceId: 'https://maps.google.com/place/abc',
      }),
    ).toMatchObject({ success: false, issues: [{ path: 'googlePlaceId' }] })
    expect(
      validateSyncOperation({
        type: 'place.google_link',
        opId,
        tripId,
        placeId,
        googlePlaceId: 'not a place id',
      }),
    ).toMatchObject({ success: false, issues: [{ path: 'googlePlaceId' }] })
  })

  it('normaliza detalhes locais e exige pelo menos um campo', () => {
    expect(
      validateSyncOperation({
        type: 'place.set_local',
        opId,
        tripId,
        placeId,
        localName: '  nome local  ',
        localAddress: null,
      }),
    ).toEqual({
      success: true,
      value: {
        type: 'place.set_local',
        opId,
        tripId,
        placeId,
        localName: 'nome local',
        localAddress: null,
      },
    })
    expect(validateSyncOperation({ type: 'place.set_local', opId, tripId, placeId })).toMatchObject(
      { success: false, issues: [{ path: 'localName' }] },
    )
  })

  it('valida place.want e place.unwant pelo identificador do lugar', () => {
    expect(validateSyncOperation({ type: 'place.want', opId, tripId, placeId })).toEqual({
      success: true,
      value: { type: 'place.want', opId, tripId, placeId },
    })
    expect(validateSyncOperation({ type: 'place.unwant', opId, tripId, placeId })).toEqual({
      success: true,
      value: { type: 'place.unwant', opId, tripId, placeId },
    })
    expect(
      validateSyncOperation({ type: 'place.want', opId, tripId, placeId: 'nao-uuid' }),
    ).toMatchObject({ success: false, issues: [{ path: 'placeId' }] })
  })

  it('valida favorito, nota e observação e normaliza texto vazio para null', () => {
    expect(
      validateSyncOperation({ type: 'place.favorite', opId, tripId, placeId, favorite: true }),
    ).toEqual({
      success: true,
      value: { type: 'place.favorite', opId, tripId, placeId, favorite: true },
    })
    expect(
      validateSyncOperation({ type: 'place.favorite', opId, tripId, placeId, favorite: 1 }),
    ).toMatchObject({ success: false, issues: [{ path: 'favorite' }] })

    for (const rating of [1, 5, null]) {
      expect(validateSyncOperation({ type: 'place.rate', opId, tripId, placeId, rating })).toEqual({
        success: true,
        value: { type: 'place.rate', opId, tripId, placeId, rating },
      })
    }
    for (const rating of [0, 6, 2.5, '3', undefined]) {
      expect(
        validateSyncOperation({ type: 'place.rate', opId, tripId, placeId, rating }),
      ).toMatchObject({ success: false, issues: [{ path: 'rating' }] })
    }

    expect(
      validateSyncOperation({ type: 'place.note', opId, tripId, placeId, note: '  Mirante  ' }),
    ).toMatchObject({ success: true, value: { note: 'Mirante' } })
    expect(
      validateSyncOperation({ type: 'place.note', opId, tripId, placeId, note: '   ' }),
    ).toMatchObject({ success: true, value: { note: null } })
    expect(
      validateSyncOperation({ type: 'place.note', opId, tripId, placeId, note: 'x'.repeat(2001) }),
    ).toMatchObject({ success: false, issues: [{ path: 'note' }] })
    expect(
      validateSyncOperation({ type: 'place.note', opId, tripId, placeId, note: 'x'.repeat(2000) }),
    ).toMatchObject({ success: true })
  })

  it('valida o alvo opcional de visita e recusa userId inválido', () => {
    expect(
      validateSyncOperation({ type: 'visit.mark', opId, tripId, placeId, userId: otherUserId }),
    ).toEqual({
      success: true,
      value: { type: 'visit.mark', opId, tripId, placeId, userId: otherUserId },
    })
    expect(validateSyncOperation({ type: 'visit.unmark', opId, tripId, placeId })).toEqual({
      success: true,
      value: { type: 'visit.unmark', opId, tripId, placeId },
    })
    expect(
      validateSyncOperation({ type: 'visit.unmark', opId, tripId, placeId, userId: 'nao-uuid' }),
    ).toMatchObject({ success: false, issues: [{ path: 'userId' }] })
  })

  it('recusa identificadores inválidos e nome vazio', () => {
    expect(validateSyncOperation({ type: 'visit.mark', opId: 'x', tripId, placeId })).toMatchObject(
      {
        success: false,
        issues: [{ path: 'opId' }],
      },
    )
    expect(
      validatePushRequest({
        operations: [{ type: 'place.add', opId, tripId, placeId, name: '  ' }],
      }),
    ).toMatchObject({ success: false, issues: [{ path: 'operations[0].name' }] })
  })

  it('valida envelope e resultados do push, incluindo motivos conhecidos', () => {
    expect(
      validatePushRequest({ operations: [{ type: 'visit.mark', opId, tripId, placeId }] }),
    ).toMatchObject({ success: true })
    expect(
      validatePushResponse({
        results: [
          { opId, status: 'applied' },
          { opId, status: 'duplicate' },
          { opId, status: 'rejected', reason: 'not_member' },
          { opId, status: 'conflict', currentVersion: 2 },
        ],
      }),
    ).toMatchObject({ success: true })
    expect(
      validatePushResponse({ results: [{ opId, status: 'rejected', reason: 'unknown' }] }),
    ).toMatchObject({ success: false })
    expect(
      validatePushResponse({ results: [{ opId, status: 'conflict', currentVersion: -1 }] }),
    ).toMatchObject({ success: false })
  })

  it('valida arranjo de roteiro como uma operação atômica', () => {
    const operation = {
      type: 'itinerary.arrange',
      opId,
      tripId,
      baseVersion: 3,
      days: [
        { dayIndex: 0, placeIds: [placeId, secondPlaceId] },
        { dayIndex: 1, placeIds: [] },
      ],
    }
    expect(validateSyncOperation(operation)).toEqual({ success: true, value: operation })
    expect(validateSyncOperation({ ...operation, baseVersion: -1 })).toMatchObject({
      success: false,
    })
    expect(validateSyncOperation({ ...operation, baseVersion: 1.5 })).toMatchObject({
      success: false,
    })
    expect(
      validateSyncOperation({
        ...operation,
        days: [operation.days[0], { dayIndex: 0, placeIds: [] }],
      }),
    ).toMatchObject({ success: false })
    expect(
      validateSyncOperation({
        ...operation,
        days: [
          { dayIndex: 0, placeIds: [placeId] },
          { dayIndex: 1, placeIds: [placeId] },
        ],
      }),
    ).toMatchObject({ success: false })
    expect(
      validateSyncOperation({
        ...operation,
        days: [
          { dayIndex: 0, placeIds: [placeId] },
          { dayIndex: 1, placeIds: [placeId.toUpperCase()] },
        ],
      }),
    ).toMatchObject({ success: false })
    expect(
      validateSyncOperation({
        ...operation,
        days: [{ dayIndex: 366, placeIds: [] }],
      }),
    ).toMatchObject({ success: false })
    expect(
      validateSyncOperation({
        ...operation,
        days: [
          {
            dayIndex: 0,
            placeIds: Array.from(
              { length: 501 },
              (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            ),
          },
        ],
      }),
    ).toMatchObject({ success: false })
    expect(validateSyncOperation({ ...operation, days: [] })).toMatchObject({ success: false })
  })

  it('valida operações de remoção e alteração de papel de membro', () => {
    expect(validateSyncOperation({ type: 'member.remove', opId, tripId, userId })).toEqual({
      success: true,
      value: { type: 'member.remove', opId, tripId, userId },
    })
    expect(
      validateSyncOperation({
        type: 'member.set_role',
        opId,
        tripId,
        userId,
        role: 'coorganizer',
      }),
    ).toEqual({
      success: true,
      value: { type: 'member.set_role', opId, tripId, userId, role: 'coorganizer' },
    })
    expect(
      validateSyncOperation({ type: 'member.set_role', opId, tripId, userId, role: 'organizer' }),
    ).toMatchObject({ success: false })
    expect(
      validateSyncOperation({ type: 'member.remove', opId, tripId, userId: 'inválido' }),
    ).toMatchObject({ success: false })
  })
})

describe('validação de encerramento de viagem', () => {
  it('valida trip.end sem campos extras', () => {
    const opId = '11111111-1111-4111-8111-111111111111'
    const tripId = '22222222-2222-4222-8222-222222222222'
    expect(validateSyncOperation({ type: 'trip.end', opId, tripId })).toEqual({
      success: true,
      value: { type: 'trip.end', opId, tripId },
    })
    expect(validateSyncOperation({ type: 'trip.end', opId, tripId: 'nao-uuid' })).toMatchObject({
      success: false,
    })
  })
})

describe('validação de abertura da viagem', () => {
  it('valida trip.open sem campos extras', () => {
    const opId = '33333333-3333-4333-8333-333333333333'
    const tripId = '22222222-2222-4222-8222-222222222222'
    expect(validateSyncOperation({ type: 'trip.open', opId, tripId })).toEqual({
      success: true,
      value: { type: 'trip.open', opId, tripId },
    })
    expect(validateSyncOperation({ type: 'trip.open', opId, tripId: 'nao-uuid' })).toMatchObject({
      success: false,
    })
  })
})

describe('validação do pull', () => {
  it('distingue início de bootstrap, continuação e pull incremental', () => {
    expect(validatePullQuery({ trip: tripId, limit: '25' })).toEqual({
      success: true,
      value: { tripId, mode: 'bootstrap', limit: 25 },
    })
    expect(
      validatePullQuery({ trip: tripId, limit: '25', cursor: '20', snapshotSeq: '30' }),
    ).toEqual({
      success: true,
      value: { tripId, mode: 'bootstrap', limit: 25, cursor: '20', snapshotSeq: '30' },
    })
    expect(validatePullQuery({ trip: tripId, limit: '25', cursor: '30' })).toEqual({
      success: true,
      value: { tripId, mode: 'incremental', limit: 25, cursor: '30' },
    })
  })

  it('recusa cursor ou limite inválidos e exige cursor na continuação do bootstrap', () => {
    expect(validatePullQuery({ trip: tripId, limit: '0' })).toMatchObject({ success: false })
    expect(validatePullQuery({ trip: tripId, limit: '10', snapshotSeq: '20' })).toMatchObject({
      success: false,
      issues: [{ path: 'cursor' }],
    })
    expect(validatePullQuery({ trip: tripId, limit: '10', cursor: '-1' })).toMatchObject({
      success: false,
      issues: [{ path: 'cursor' }],
    })
  })

  it('valida páginas de bootstrap e o erro bootstrap_required', () => {
    const place = {
      id: placeId,
      tripId,
      provider: null,
      providerRef: null,
      providerDatasource: null,
      attribution: null,
      license: null,
      name: 'Lugar',
      localName: null,
      address: null,
      localAddress: null,
      countryCode: null,
      googlePlaceId: null,
      googleMatch: 'none',
      userLocalName: null,
      userLocalAddress: null,
      lat: null,
      lng: null,
      suggestedBy: userId,
      comment: null,
      dayIndex: null,
      position: null,
      seq: '1',
      deletedAt: null,
      createdAt: '2026-10-20T12:00:00.000Z',
    }
    const bootstrap = {
      mode: 'bootstrap',
      snapshotSeq: '42',
      places: [place],
      visits: [],
      wants: [],
      reviews: [],
      members: [],
      itinerary: { version: 2, atSeq: '42' },
      nextCursor: '42',
      hasMore: false,
    }
    expect(validatePullResponse(bootstrap)).toEqual({ success: true, value: bootstrap })
    expect(validatePullResponse({ error: 'bootstrap_required' })).toEqual({
      success: true,
      value: { error: 'bootstrap_required' },
    })
    expect(validatePullResponse({ error: 'not_member' })).toEqual({
      success: true,
      value: { error: 'not_member' },
    })
    expect(validatePullResponse({ ...bootstrap, nextCursor: 42 })).toMatchObject({
      success: false,
    })
    expect(
      validatePullResponse({ ...bootstrap, itinerary: { version: -1, atSeq: '42' } }),
    ).toMatchObject({ success: false })
    const placeWithoutCountryCode = Object.fromEntries(
      Object.entries(place).filter(([key]) => key !== 'countryCode'),
    )
    expect(validatePullResponse({ ...bootstrap, places: [placeWithoutCountryCode] })).toMatchObject(
      { success: false },
    )
  })
})

describe('contratos de convite', () => {
  it('valida o token recebido e o token enviado', () => {
    expect(validateCreateInviteParams({ tripId })).toEqual({ success: true, value: { tripId } })
    expect(validateCreateInviteResponse({ token: 'abc123' })).toEqual({
      success: true,
      value: { token: 'abc123' },
    })
    const termsVersion = RECAP_SHARING_TERMS_VERSION
    expect(validateAcceptInviteRequest({ token: '  abc123  ', termsVersion })).toEqual({
      success: true,
      value: { token: 'abc123', termsVersion },
    })
    expect(validateAcceptInviteRequest({ token: ' ', termsVersion })).toMatchObject({
      success: false,
    })
    expect(validateAcceptInviteRequest({ token: 'abc123' })).toMatchObject({ success: false })
    expect(validateAcceptInviteRequest({ token: 'abc123', termsVersion: 'antiga' })).toMatchObject({
      success: false,
    })
  })
})

describe('canonicalTripState', () => {
  const place = (id: string, deletedAt: string | null = null): SyncPlace => ({
    id,
    tripId,
    provider: null,
    providerRef: null,
    providerDatasource: null,
    attribution: null,
    license: null,
    countryCode: null,
    name: 'Lugar',
    localName: null,
    address: null,
    localAddress: null,
    googlePlaceId: null,
    googleMatch: 'none',
    userLocalName: null,
    userLocalAddress: null,
    lat: null,
    lng: null,
    suggestedBy: userId,
    comment: null,
    dayIndex: null,
    position: null,
    seq: '1',
    deletedAt,
    createdAt: '2026-10-20T12:00:00.000Z',
  })
  const visit = (
    placeKey: string,
    userKey: string,
    deletedAt: string | null = null,
  ): SyncVisit => ({
    placeId: placeKey,
    tripId,
    userId: userKey,
    markedBy: userKey,
    visitedAt: '2026-10-20T12:00:00.000Z',
    visitedTz: 'America/Sao_Paulo',
    seq: '2',
    deletedAt,
  })
  const want = (placeKey: string, userKey: string, deletedAt: string | null = null): SyncWant => ({
    placeId: placeKey,
    tripId,
    userId: userKey,
    createdAt: '2026-10-20T12:00:00.000Z',
    seq: '4',
    deletedAt,
  })
  const review = (
    placeKey: string,
    userKey: string,
    deletedAt: string | null = null,
  ): SyncReview => ({
    placeId: placeKey,
    tripId,
    userId: userKey,
    favorite: true,
    rating: 4,
    note: 'Vale a pena',
    updatedAt: '2026-10-20T12:00:00.000Z',
    seq: '5',
    deletedAt,
  })
  const member = (id: string, deletedAt: string | null = null): SyncMember => ({
    tripId,
    userId: id,
    role: 'member',
    joinedAt: '2026-10-20T12:00:00.000Z',
    openedAt: null,
    seq: '3',
    deletedAt,
  })

  it('remove tombstones e ordena cada coleção por suas chaves estáveis', () => {
    const state = canonicalTripState({
      places: [place(placeId), place('1a000000-0000-4000-8000-000000000000')],
      visits: [visit(placeId, otherUserId), visit(placeId, userId)],
      wants: [want(placeId, otherUserId), want(placeId, userId, '2026-10-20T13:00:00.000Z')],
      reviews: [review(placeId, otherUserId), review(placeId, userId, '2026-10-20T13:00:00.000Z')],
      members: [member(otherUserId), member(userId, '2026-10-20T13:00:00.000Z')],
    })
    expect(state.reviews.map(({ userId: id }) => id)).toEqual([otherUserId])
    expect(state.places.map(({ id }) => id)).toEqual([
      '1a000000-0000-4000-8000-000000000000',
      placeId,
    ])
    expect(state.visits.map(({ userId: id }) => id)).toEqual([userId, otherUserId])
    expect(state.wants.map(({ userId: id }) => id)).toEqual([otherUserId])
    expect(state.members.map(({ userId: id }) => id)).toEqual([otherUserId])
  })
})
