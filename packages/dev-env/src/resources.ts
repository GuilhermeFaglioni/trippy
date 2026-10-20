export interface QueueResource {
  name: string
  deadLetterQueueName: string
  visibilityTimeoutSeconds: number
}

export interface LocalResources {
  buckets: string[]
  queues: QueueResource[]
}

export function resourcesFor(environment: NodeJS.ProcessEnv = process.env): LocalResources {
  const thumbsQueue = environment.SQS_QUEUE_THUMBS?.trim() || 'trippy-thumbs'
  const recapQueue = environment.SQS_QUEUE_RECAP?.trim() || 'trippy-recap'

  return {
    buckets: [
      environment.S3_BUCKET_PHOTOS?.trim() || 'trippy-photos',
      environment.S3_BUCKET_VIDEOS?.trim() || 'trippy-videos',
    ],
    queues: [
      {
        name: thumbsQueue,
        deadLetterQueueName: `${thumbsQueue}-dlq`,
        visibilityTimeoutSeconds: 60,
      },
      {
        name: recapQueue,
        deadLetterQueueName: `${recapQueue}-dlq`,
        visibilityTimeoutSeconds: 300,
      },
    ],
  }
}
