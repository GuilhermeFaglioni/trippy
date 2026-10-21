import { createTripsClient, TripsApiError, type TripSummary } from '../trips-client'

const trip: TripSummary = {
  id: '58f75ed5-b524-46f8-b387-650d9b43ee36',
  name: 'Fim de semana',
  destination: 'Paraty',
  startDate: '2027-03-14',
  endDate: '2027-03-16',
  timezone: 'America/Sao_Paulo',
  role: 'organizer',
  phase: 'planning',
  createdAt: '2026-10-20T12:00:00.000Z',
}

describe('cliente de viagens', () => {
  it('lista viagens usando a requisição autenticada da sessão', async () => {
    const request = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ trips: [trip] }), { status: 200 }))
    const client = createTripsClient(request)

    await expect(client.listTrips()).resolves.toEqual([trip])
    expect(request).toHaveBeenCalledWith('/trips')
  })

  it('rejeita resposta com ID de viagem que não seja UUID', async () => {
    const request = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ trips: [{ ...trip, id: 'trip-1' }] }), { status: 200 }),
      )
    const client = createTripsClient(request)

    await expect(client.listTrips()).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_error',
    })
  })

  it('cria uma viagem enviando o contrato da API em JSON', async () => {
    const input = {
      name: 'Fim de semana',
      destination: 'Paraty',
      startDate: '2027-03-14',
      endDate: '2027-03-16',
      timezone: 'America/Sao_Paulo',
    }
    const request = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ trip }), { status: 201 }))
    const client = createTripsClient(request)

    await expect(client.createTrip(input)).resolves.toEqual(trip)
    expect(request).toHaveBeenCalledWith('/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('preserva mensagem e código de erro retornados pela API', async () => {
    const request = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_trip',
          message: 'A data de volta não pode ser anterior à data de ida.',
          fields: { endDate: 'Data inválida.' },
        }),
        { status: 400 },
      ),
    )
    const client = createTripsClient(request)

    await expect(
      client.createTrip({
        name: 'Fim de semana',
        destination: 'Paraty',
        startDate: '2027-03-16',
        endDate: '2027-03-14',
        timezone: 'America/Sao_Paulo',
      }),
    ).rejects.toMatchObject<Partial<TripsApiError>>({
      status: 400,
      code: 'invalid_trip',
      message: 'A data de volta não pode ser anterior à data de ida.',
      fields: { endDate: 'Data inválida.' },
    })
  })
})
