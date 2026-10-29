import { canonicalTripState, isUuid } from '@trippy/sync'

describe('@trippy/sync no app mobile', () => {
  it('resolve os contratos compartilhados no teste do Jest', () => {
    expect(isUuid('58f75ed5-b524-46f8-b387-650d9b43ee36')).toBe(true)
    expect(canonicalTripState({ places: [], visits: [], wants: [], members: [] })).toEqual({
      places: [],
      visits: [],
      wants: [],
      members: [],
    })
  })
})
