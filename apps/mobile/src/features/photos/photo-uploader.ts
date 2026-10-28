import { fetch } from 'expo/fetch'
import { File } from 'expo-file-system'

export async function uploadPhotoToSignedUrl(signedUrl: string, uploadUri: string): Promise<void> {
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new File(uploadUri),
  })

  if (!response.ok) {
    throw new Error(`O envio da foto falhou (HTTP ${response.status}).`)
  }
}
