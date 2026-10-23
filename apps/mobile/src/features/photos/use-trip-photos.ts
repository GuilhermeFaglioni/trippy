import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect } from 'expo-router'

import { useSession } from '../auth/session-provider'
import { usePhotosClient, type RemoteTripPhoto } from './photo-client'
import { expoPhotoFiles } from './expo-photo-files'
import { enqueueSelectedPhoto } from './photo-preparation'
import { openPhotoQueueRepository, type QueuedPhoto } from './photo-queue'
import { usePhotoUploadQueue } from './photo-upload-queue-provider'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'Não foi possível concluir a solicitação. Confira sua conexão e tente novamente.'
}

export type UseTripPhotosResult = {
  localPhotos: QueuedPhoto[]
  remotePhotos: RemoteTripPhoto[]
  isLoading: boolean
  isAdding: boolean
  isRetrying: boolean
  loadError: string | null
  remoteError: string | null
  actionError: string | null
  addPhotos(): Promise<void>
  retryUploads(): Promise<void>
}

export function useTripPhotos(tripId: string): UseTripPhotosResult {
  const { session } = useSession()
  const client = usePhotosClient()
  const { drainTrip } = usePhotoUploadQueue()
  const userId = session?.user.id ?? ''
  const [localPhotos, setLocalPhotos] = useState<QueuedPhoto[]>([])
  const [remotePhotos, setRemotePhotos] = useState<RemoteTripPhoto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refreshPhotos = useCallback(async () => {
    try {
      const queue = await openPhotoQueueRepository(userId)
      setLocalPhotos(await queue.listTripPhotos(tripId))
      setLoadError(null)
    } catch (error) {
      setLoadError(getErrorMessage(error))
    }

    try {
      setRemotePhotos(await client.listTripPhotos(tripId))
      setRemoteError(null)
    } catch (error) {
      setRemoteError(getErrorMessage(error))
    }
  }, [client, tripId, userId])

  useFocusEffect(
    useCallback(() => {
      let active = true

      const loadAndResume = async () => {
        setIsLoading(true)
        await refreshPhotos()
        if (active) await drainTrip(tripId)
        if (active) await refreshPhotos()
        if (active) setIsLoading(false)
      }

      void loadAndResume().catch((error: unknown) => {
        if (active) {
          setLoadError(getErrorMessage(error))
          setIsLoading(false)
        }
      })

      return () => {
        active = false
      }
    }, [drainTrip, refreshPhotos, tripId]),
  )

  const addPhotos = useCallback(async () => {
    if (!userId) {
      setActionError('Entre na sua conta antes de adicionar fotos.')
      return
    }

    setActionError(null)
    setIsAdding(true)
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        setActionError('Permita acesso às fotos para escolher imagens da viagem.')
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
        exif: true,
        quality: 1,
        base64: false,
      })
      if (result.canceled || !result.assets?.length) return

      const queue = await openPhotoQueueRepository(userId)
      let failedPhotos = 0
      for (const asset of result.assets) {
        if (asset.type !== null && asset.type !== 'image') continue
        try {
          await enqueueSelectedPhoto(
            {
              uri: asset.uri,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              width: asset.width,
              height: asset.height,
              exif: asset.exif,
            },
            userId,
            tripId,
            {
              createId: Crypto.randomUUID,
              files: expoPhotoFiles,
              queue,
            },
          )
        } catch {
          failedPhotos += 1
        }
      }

      if (failedPhotos > 0) {
        setActionError(
          failedPhotos === 1
            ? 'Uma foto não pôde ser preparada. Ela continua na fila para tentar novamente.'
            : `${failedPhotos} fotos não puderam ser preparadas. Elas continuam na fila para tentar novamente.`,
        )
      }

      await refreshPhotos()
      await drainTrip(tripId)
      await refreshPhotos()
    } catch (error) {
      setActionError(getErrorMessage(error))
      await refreshPhotos()
    } finally {
      setIsAdding(false)
    }
  }, [drainTrip, refreshPhotos, tripId, userId])

  const retryUploads = useCallback(async () => {
    setIsRetrying(true)
    setActionError(null)
    try {
      await drainTrip(tripId)
      await refreshPhotos()
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      setIsRetrying(false)
    }
  }, [drainTrip, refreshPhotos, tripId])

  return {
    localPhotos,
    remotePhotos,
    isLoading,
    isAdding,
    isRetrying,
    loadError,
    remoteError,
    actionError,
    addPhotos,
    retryUploads,
  }
}
