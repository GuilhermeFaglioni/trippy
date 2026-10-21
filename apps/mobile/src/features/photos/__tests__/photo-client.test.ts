import { createPhotosClient, type PhotoRequest } from '../photo-client'

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('PhotosClient', () => {
  it('reserves an upload using the published contract and preserves the signed URL', async () => {
    const signedUrl = 'http://localhost:59000/trippy-photos/trip-a/photo-a?X-Amz-Signature=keep'
    const request = jest
      .fn<ReturnType<PhotoRequest>, Parameters<PhotoRequest>>()
      .mockResolvedValue(response(201, { id: 'photo-a', uploadUrl: signedUrl }))
    const client = createPhotosClient(request)

    await expect(
      client.reserveUpload('trip/a', {
        id: 'photo-a',
        takenAtOriginal: '2026-10-20T07:06:05',
        takenTz: null,
        lat: 31.22,
        lng: -121.47,
      }),
    ).resolves.toEqual({ id: 'photo-a', uploadUrl: signedUrl })

    expect(request).toHaveBeenCalledWith('/trips/trip%2Fa/photos/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'photo-a',
        takenAtOriginal: '2026-10-20T07:06:05',
        takenTz: null,
        lat: 31.22,
        lng: -121.47,
      }),
    })
  })

  it('confirms uploads and lists photos without a place', async () => {
    const request = jest
      .fn<ReturnType<PhotoRequest>, Parameters<PhotoRequest>>()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(
        response(200, {
          photos: [
            {
              id: 'photo-a',
              status: 'ready',
              placeId: null,
              takenAtOriginal: null,
              takenTz: null,
              lat: null,
              lng: null,
            },
          ],
        }),
      )
    const client = createPhotosClient(request)

    await expect(client.completeUpload('trip-a', 'photo-a')).resolves.toBeUndefined()
    await expect(client.listTripPhotos('trip-a')).resolves.toEqual([
      {
        id: 'photo-a',
        status: 'ready',
        placeId: null,
        takenAtOriginal: null,
        takenTz: null,
        lat: null,
        lng: null,
      },
    ])
    expect(request.mock.calls[0]).toEqual([
      '/trips/trip-a/photos/photo-a/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    ])
    expect(request.mock.calls[1][0]).toBe('/trips/trip-a/photos')
  })

  it('rejects malformed reservations instead of losing the local UUID', async () => {
    const request = jest
      .fn<ReturnType<PhotoRequest>, Parameters<PhotoRequest>>()
      .mockResolvedValue(response(201, { id: 'different-id', uploadUrl: '' }))
    const client = createPhotosClient(request)

    await expect(
      client.reserveUpload('trip-a', {
        id: 'photo-a',
        takenAtOriginal: null,
        takenTz: null,
        lat: null,
        lng: null,
      }),
    ).rejects.toMatchObject({ code: 'unexpected_error' })
  })
})
