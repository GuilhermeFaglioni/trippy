import type { PushResponse, PullResponse } from '@trippy/sync'

import { createSyncTransport } from '../sync-transport'

describe('transporte HTTP de sync', () => {
  it('envia lote para /sync/push e devolve os resultados por operação', async () => {
    const payload: PushResponse = {
      results: [{ opId: 'op-1', status: 'applied' }],
    }
    const request = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const transport = createSyncTransport(request)
    const operations = [
      {
        opId: 'op-1',
        tripId: 'trip-1',
        type: 'place.add' as const,
        placeId: 'place-1',
        name: 'Café do Porto',
      },
    ]

    await expect(transport.push({ operations })).resolves.toEqual(payload)
    expect(request).toHaveBeenCalledWith('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    })
  })

  it('mapeia cursor e snapshot na consulta paginada de bootstrap', async () => {
    const payload: PullResponse = {
      mode: 'bootstrap',
      snapshotSeq: '15',
      places: [],
      visits: [],
      wants: [],
      reviews: [],
      members: [],
      itinerary: { version: 0, atSeq: '15' },
      nextCursor: '10',
      hasMore: true,
    }
    const request = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const transport = createSyncTransport(request)

    await expect(
      transport.pull({
        tripId: 'trip-1',
        mode: 'bootstrap',
        limit: 5,
        snapshotSeq: '15',
        cursor: '5',
      }),
    ).resolves.toEqual(payload)

    expect(request).toHaveBeenCalledWith('/sync/pull?trip=trip-1&limit=5&cursor=5&snapshotSeq=15', {
      method: 'GET',
    })
  })

  it('preserva 403 not_member como resposta tipada de pull', async () => {
    const request = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'not_member' }), { status: 403 }))
    const transport = createSyncTransport(request)

    await expect(
      transport.pull({ tripId: 'trip-1', mode: 'incremental', limit: 10, cursor: '4' }),
    ).resolves.toEqual({ error: 'not_member' })
  })
})
