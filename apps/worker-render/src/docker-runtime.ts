import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { containerDatabaseUrl, containerServiceUrl, type DispatcherConfig } from './config.ts'

type CommandResult = Readonly<{ stdout: string; stderr: string }>

export type ContainerState = Readonly<{
  id: string | null
  status: 'running' | 'exited' | 'created' | 'paused' | 'missing' | 'foreign' | 'other'
  exitCode: number | null
}>

export type WorkerLaunch = Readonly<{
  jobId: string
  fencingToken: number
  executionName: string
}>

export class DockerRuntime {
  constructor(
    private readonly config: DispatcherConfig,
    private readonly executable = 'docker',
  ) {}

  async buildImage(repositoryRoot: string): Promise<void> {
    await runCommand(this.executable, [
      'buildx',
      'build',
      '--platform',
      'linux/amd64',
      '--load',
      '--tag',
      this.config.renderImage,
      '--file',
      join(repositoryRoot, 'apps/worker-render/Dockerfile'),
      repositoryRoot,
    ])
  }

  async imagePlatform(): Promise<string> {
    const result = await runCommand(this.executable, [
      'image',
      'inspect',
      '--format',
      '{{.Os}}/{{.Architecture}}',
      this.config.renderImage,
    ])
    return result.stdout.trim()
  }

  async launchWorker(input: WorkerLaunch): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'trippy-spike19-env-'))
    const envFile = join(directory, 'worker.env')
    try {
      await writeFile(envFile, this.workerEnvironment(input), { encoding: 'utf8', mode: 0o600 })
      const result = await runCommand(this.executable, [
        'run',
        '--detach',
        '--init',
        '--rm',
        '--name',
        input.executionName,
        '--label',
        `com.trippy.spike-run=${this.config.runId}`,
        '--platform',
        'linux/amd64',
        '--cpus',
        '2',
        '--memory',
        '4g',
        '--memory-swap',
        '4g',
        '--pids-limit',
        '512',
        '--shm-size',
        '512m',
        '--env-file',
        envFile,
        this.config.renderImage,
      ])
      const containerId = result.stdout.trim().split(/\s+/).at(-1)
      if (!containerId) throw new Error('Docker não retornou o ID do container')
      return containerId
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async inspect(containerId: string): Promise<ContainerState> {
    let result: CommandResult
    try {
      result = await runCommand(this.executable, [
        'inspect',
        '--format',
        '{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{index .Config.Labels "com.trippy.spike-run"}}',
        containerId,
      ])
    } catch (error) {
      if (error instanceof Error && error.message.includes('No such object')) {
        return { id: null, status: 'missing', exitCode: null }
      }
      throw error
    }

    const [id, status, exitCode, runId] = result.stdout.trim().split('|')
    if (runId !== this.config.runId) return { id: id ?? null, status: 'foreign', exitCode: null }
    const knownStatuses = new Set(['running', 'exited', 'created', 'paused'])
    return {
      id: id ?? null,
      status: knownStatuses.has(status ?? '')
        ? (status as ContainerState['status'])
        : 'other',
      exitCode: exitCode ? Number(exitCode) : null,
    }
  }

  async stop(containerId: string): Promise<void> {
    const state = await this.inspect(containerId)
    if (state.status === 'missing' || state.status === 'exited') return
    if (state.status === 'foreign') {
      throw new Error('Recusado parar container sem a etiqueta deste ensaio')
    }
    await runCommand(this.executable, [
      'stop',
      '--time',
      '10',
      state.id ?? containerId,
    ])
  }

  async remove(containerId: string): Promise<void> {
    const state = await this.inspect(containerId)
    if (state.status === 'missing') return
    if (state.status === 'foreign') {
      throw new Error('Recusado remover container sem a etiqueta deste ensaio')
    }
    await runCommand(this.executable, ['rm', '--force', state.id ?? containerId])
  }

  private workerEnvironment(input: WorkerLaunch): string {
    const values: Record<string, string> = {
      DATABASE_URL: containerDatabaseUrl(this.config.databaseUrl),
      AWS_REGION: this.config.region,
      AWS_ACCESS_KEY_ID: this.config.accessKeyId,
      AWS_SECRET_ACCESS_KEY: this.config.secretAccessKey,
      S3_ENDPOINT: containerServiceUrl(this.config.s3Endpoint),
      S3_FORCE_PATH_STYLE: 'true',
      S3_BUCKET_PHOTOS: this.config.photosBucket,
      S3_BUCKET_VIDEOS: this.config.videosBucket,
      TRIPPY_SPIKE_RUN_ID: this.config.runId,
      RENDER_JOB_ID: input.jobId,
      RENDER_FENCING_TOKEN: String(input.fencingToken),
      RENDER_LEASE_DURATION_MS: String(this.config.leaseDurationMs),
    }

    return Object.entries(values)
      .map(([key, value]) => {
        if (/[\r\n]/.test(value)) throw new Error(`Valor multiline não permitido em ${key}`)
        return `${key}=${value}`
      })
      .join('\n')
      .concat('\n')
  }
}

function runCommand(executable: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${executable} ${args[0]} falhou com código ${code}: ${stderr.trim()}`))
    })
  })
}
