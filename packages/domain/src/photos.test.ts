import { expect, it } from 'vitest'
import { validatePhotoUploadInput } from './photos.ts'

it('valida metadados originais de uma foto e mantém valores ausentes como nulos', () => {
  const result = validatePhotoUploadInput({
    id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
    takenAtOriginal: '2026-10-20T13:45:12',
    takenTz: 'Asia/Shanghai',
    lat: 31.2304,
    lng: 121.4737,
  })

  expect(result).toEqual({
    success: true,
    value: {
      id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
      takenAtOriginal: '2026-10-20T13:45:12',
      takenTz: 'Asia/Shanghai',
      lat: 31.2304,
      lng: 121.4737,
    },
  })
})

it('normaliza campos opcionais ausentes para null', () => {
  expect(validatePhotoUploadInput({ id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2' })).toEqual({
    success: true,
    value: {
      id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
    },
  })
})

it('rejeita UUID inválido, metadado com tipo incorreto e coordenadas fora do limite', () => {
  expect(validatePhotoUploadInput({ id: 'id-invalido' })).toMatchObject({ success: false })
  expect(
    validatePhotoUploadInput({
      id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
      takenAtOriginal: 123,
    }),
  ).toMatchObject({ success: false })
  expect(
    validatePhotoUploadInput({
      id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
      lat: 91,
      lng: 0,
    }),
  ).toMatchObject({ success: false })
  expect(
    validatePhotoUploadInput({
      id: 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2',
      lat: 0,
    }),
  ).toMatchObject({ success: false })
})
