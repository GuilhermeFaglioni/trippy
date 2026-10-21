import { createInviteClient } from '../invite-client'

const trip = {
  id: '58f75ed5-b524-46f8-b387-650d9b43ee36',
  name: 'Fim de semana',
  destination: 'Paraty',
  startDate: '2027-03-14',
  endDate: '2027-03-16',
  timezone: 'America/Sao_Paulo',
  role: 'member' as const,
  phase: 'planning' as const,
  createdAt: '2026-10-20T12:00:00.000Z',
}

describe('cliente de convites', () => {
  it('aceita token e valida viagem devolvida pela API', async () => {
    const request = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 200 }))
    const client = createInviteClient(request)

    await expect(client.accept(' convite-abc ')).resolves.toEqual(trip)
    expect(request).toHaveBeenCalledWith('/invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'convite-abc' }),
    })
  })

  it('cria convite para uma viagem e valida código retornado', async () => {
    const request = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'token-secreto' }), { status: 201 }))
    const client = createInviteClient(request)

    await expect(client.create('trip-1')).resolves.toBe('token-secreto')
    expect(request).toHaveBeenCalledWith('/trips/trip-1/invites', { method: 'POST' })
  })
})
