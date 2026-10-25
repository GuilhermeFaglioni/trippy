import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addMcpCapabilities } from 'expo-mcp'
import { z } from 'zod'

const requireFromMobile = createRequire(import.meta.url)
const expoMcpEntry = requireFromMobile.resolve('expo-mcp')
const requireFromExpoMcp = createRequire(expoMcpEntry)
const mcpTunnelEntry = requireFromExpoMcp.resolve('@expo/mcp-tunnel')
const { TunnelMcpServerProxy } = await import(pathToFileURL(mcpTunnelEntry).href)
const requireFromMcpTunnel = createRequire(mcpTunnelEntry)
const { McpServer } = requireFromMcpTunnel('@modelcontextprotocol/sdk/server/mcp.js')
const { Client } = requireFromMcpTunnel('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = requireFromMcpTunnel('@modelcontextprotocol/sdk/inMemory.js')
const { JSON_RPC_VERSION, WS_METHOD_MCP_TOOLS_CALL } = requireFromMcpTunnel('@expo/mcp-tunnel')
const expoEntry = requireFromMobile.resolve('expo')
const cliPackageJson = createRequire(expoEntry).resolve('@expo/cli/package.json')
const requireFromCli = createRequire(cliPackageJson)
const cliRoot = dirname(cliPackageJson)
const { createMCPDevToolsExtensionSchema } = requireFromCli(
  join(cliRoot, 'build/src/start/server/createMCPDevToolsExtensionSchema.js'),
)
const { addMcpCapabilities: addCliMcpCapabilities } = requireFromCli(
  join(cliRoot, 'build/src/start/server/MCPDevToolsPluginCLIExtensions.js'),
)
const { PluginSchema } = requireFromCli(
  join(cliRoot, 'build/src/start/server/DevToolsPlugin.schema.js'),
)
const { Log: cliLog } = requireFromCli(join(cliRoot, 'build/src/log.js'))

const silentLogger = Object.fromEntries(
  ['debug', 'log', 'info', 'warn', 'error', 'time', 'timeEnd'].map((method) => [method, () => {}]),
)

function createProxy() {
  return new TunnelMcpServerProxy('wss://127.0.0.1:1', {
    projectRoot: process.cwd(),
    devServerUrl: 'http://127.0.0.1:8081',
    logger: silentLogger,
  })
}

async function withMcpClient(server, run, setup = async () => {}) {
  await setup()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'trippy-contract-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  try {
    return await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

function createPlaceInputSchema() {
  return {
    placeName: z.string(),
    source: z.enum(['geoapify', 'manual']),
    note: z.string().optional(),
    location: z.object({
      latitude: z.number(),
      region: z.enum(['north', 'south']),
    }),
  }
}

test('Expo MCP resolves the patched tunnel with Zod 4 support', () => {
  assert.equal(mcpTunnelEntry, requireFromMobile.resolve('@expo/mcp-tunnel'))
  assert.equal(typeof requireFromExpoMcp('zod').toJSONSchema, 'function')
})

test('Expo MCP publishes required, enum, optional and nested tool arguments', () => {
  const proxy = createProxy()
  const shape = createPlaceInputSchema()

  proxy.registerTool('save_place', { inputSchema: shape }, async () => ({ content: [] }))

  const schema = proxy.getRegisteredTools().get('save_place')?.inputSchema
  assert.ok(schema)
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['placeName', 'source', 'location'])
  assert.deepEqual(schema.properties.source.enum, ['geoapify', 'manual'])
  assert.equal(schema.properties.note.type, 'string')
  assert.equal(schema.required.includes('note'), false)
  assert.deepEqual(schema.properties.location.required, ['latitude', 'region'])
  assert.deepEqual(schema.properties.location.properties.region.enum, ['north', 'south'])

  const input = z.object(shape)
  assert.equal(
    input.safeParse({
      placeName: 'Jardim Botânico',
      source: 'geoapify',
      location: { latitude: -25.44, region: 'south' },
    }).success,
    true,
  )
  assert.equal(
    input.safeParse({
      placeName: 'Jardim Botânico',
      source: 'google',
      location: { latitude: -25.44, region: 'west' },
    }).success,
    false,
  )
})

test('MCP tools/call dispatch validates arguments and executes the registered callback', async () => {
  const schema = createPlaceInputSchema()
  const server = new McpServer({ name: 'trippy-contract-test', version: '1.0.0' })
  const effects = []
  server.registerTool('save_place', { inputSchema: schema }, async (args) => {
    effects.push(args)
    return { content: [{ type: 'text', text: JSON.stringify(args) }] }
  })

  await withMcpClient(server, async (client) => {
    const { tools } = await client.listTools()
    const tool = tools.find(({ name }) => name === 'save_place')
    assert.ok(tool)
    assert.deepEqual(tool.inputSchema.required, ['placeName', 'source', 'location'])
    assert.deepEqual(tool.inputSchema.properties.source.enum, ['geoapify', 'manual'])
    assert.equal(tool.inputSchema.required.includes('note'), false)
    assert.deepEqual(tool.inputSchema.properties.location.required, ['latitude', 'region'])
    assert.deepEqual(tool.inputSchema.properties.location.properties.region.enum, [
      'north',
      'south',
    ])

    const validArguments = {
      placeName: 'Jardim Botânico',
      source: 'geoapify',
      location: { latitude: -25.44, region: 'south' },
    }
    const valid = await client.callTool({ name: 'save_place', arguments: validArguments })
    assert.equal(valid.isError, undefined)
    assert.deepEqual(JSON.parse(valid.content[0].text), validArguments)
    assert.deepEqual(effects, [validArguments])

    for (const arguments_ of [
      { source: 'geoapify', location: { latitude: -25.44, region: 'south' } },
      {
        placeName: 'Jardim Botânico',
        source: 'google',
        location: { latitude: -25.44, region: 'south' },
      },
      {
        placeName: 'Jardim Botânico',
        source: 'geoapify',
        location: { latitude: -25.44, region: 'west' },
      },
    ]) {
      const invalid = await client.callTool({ name: 'save_place', arguments: arguments_ })
      assert.equal(invalid.isError, true)
    }

    assert.deepEqual(
      effects,
      [validArguments],
      'invalid arguments must not reach the tool callback',
    )
  })
})

test('Expo tunnel dispatch invokes the registered MCP tool handler with explicit arguments', async () => {
  const proxy = createProxy()
  const effects = []
  const validArguments = {
    placeName: 'Jardim Botânico',
    source: 'manual',
    note: 'entrada norte',
    location: { latitude: -25.44, region: 'south' },
  }
  proxy.registerTool('save_place', { inputSchema: createPlaceInputSchema() }, async (args) => {
    effects.push(args)
    return { content: [{ type: 'text', text: `saved:${args.placeName}:${args.location.region}` }] }
  })

  const responsePromise = new Promise((resolve) => {
    proxy.transport.send = async (response) => resolve(response)
  })
  proxy.transport.onMessage({
    jsonrpc: JSON_RPC_VERSION,
    id: 1,
    method: WS_METHOD_MCP_TOOLS_CALL,
    params: { name: 'save_place', arguments: validArguments },
  })
  const response = await responsePromise

  assert.deepEqual(effects, [validArguments])
  assert.equal(response.jsonrpc, JSON_RPC_VERSION)
  assert.equal(response.id, 1)
  assert.equal(response.result.content[0].text, 'saved:Jardim Botânico:south')
})

test('Expo MCP publishes required and optional prompt arguments', () => {
  const proxy = createProxy()
  proxy.registerPrompt(
    'plan_trip',
    {
      argsSchema: {
        destination: z.enum(['Lisboa', 'Curitiba']),
        tone: z.string().optional(),
      },
    },
    async () => ({ description: 'Plano da viagem', messages: [] }),
  )

  const schema = proxy.getRegisteredPrompts().get('plan_trip')?.argsSchema
  assert.ok(schema)
  assert.deepEqual(schema.required, ['destination'])
  assert.deepEqual(schema.properties.destination.enum, ['Lisboa', 'Curitiba'])
  assert.equal(schema.required.includes('tone'), false)
})

test('Expo MCP tool schemas survive registration through the CLI tunnel', () => {
  const proxy = createProxy()
  const rawSchemas = new Map()
  const server = {
    devServerUrl: proxy.devServerUrl,
    registerTool(name, config, callback) {
      rawSchemas.set(name, config.inputSchema)
      proxy.registerTool(name, config, callback)
    },
    registerPrompt: proxy.registerPrompt,
    registerResource: proxy.registerResource,
  }

  addMcpCapabilities(server, process.cwd())

  const openDevtools = proxy.getRegisteredTools().get('open_devtools')?.inputSchema
  assert.ok(openDevtools)
  assert.deepEqual(openDevtools.required, ['projectRoot'])
  assert.deepEqual(openDevtools.properties.platform.enum, ['android', 'ios'])
  assert.equal(openDevtools.required.includes('platform'), false)
  assert.equal(
    z
      .object(rawSchemas.get('open_devtools'))
      .safeParse({ projectRoot: '/tmp/trippy', platform: 'ios' }).success,
    true,
  )
  assert.equal(
    z
      .object(rawSchemas.get('open_devtools'))
      .safeParse({ projectRoot: '/tmp/trippy', platform: 'web' }).success,
    false,
  )

  const collectLogs = proxy.getRegisteredTools().get('collect_app_logs')?.inputSchema
  assert.ok(collectLogs)
  assert.deepEqual(collectLogs.required, ['projectRoot'])
  assert.deepEqual(collectLogs.properties.sources.items.enum, [
    'native_android',
    'native_ios',
    'js_console',
  ])
  const defaults = z
    .object(rawSchemas.get('collect_app_logs'))
    .safeParse({ projectRoot: '/tmp/trippy' })
  assert.equal(defaults.success, true)
  assert.deepEqual(defaults.data.sources, ['js_console'])
  assert.equal(defaults.data.durationMs, 2000)
  assert.equal(
    z
      .object(rawSchemas.get('collect_app_logs'))
      .safeParse({ projectRoot: '/tmp/trippy', sources: ['unknown'] }).success,
    false,
  )
})

test('Expo CLI keeps local MCP command enums and optional parameters', () => {
  const schema = createMCPDevToolsExtensionSchema({
    packageName: '@trippy/example-plugin',
    cliExtensions: {
      commands: [
        {
          name: 'search',
          title: 'Buscar lugares',
          parameters: [{ name: 'query', type: 'text', description: 'Texto da busca' }],
        },
        { name: 'save', title: 'Salvar lugar' },
      ],
    },
  })

  assert.equal(schema.safeParse({ command: 'search', query: 'cafe' }).success, true)
  assert.equal(schema.safeParse({ command: 'delete' }).success, false)

  const jsonSchema = z.toJSONSchema(schema)
  assert.deepEqual(jsonSchema.required, ['command'])
  assert.deepEqual(jsonSchema.properties.command.enum, ['search', 'save'])
  assert.equal(jsonSchema.properties.query.type, 'string')
  assert.equal(jsonSchema.required.includes('query'), false)
})

test('Expo CLI validates MCP plugin required fields and enums', () => {
  const plugin = {
    packageName: '@trippy/example-plugin',
    packageRoot: '/tmp/example-plugin',
    cliExtensions: {
      description: 'Ferramentas de exemplo',
      entryPoint: 'index.js',
      commands: [{ name: 'search', title: 'Buscar', environments: ['mcp'] }],
    },
  }

  assert.equal(PluginSchema.safeParse(plugin).success, true)
  assert.equal(
    PluginSchema.safeParse({
      ...plugin,
      cliExtensions: {
        ...plugin.cliExtensions,
        commands: [{ name: 'search', title: 'Buscar', environments: ['web'] }],
      },
    }).success,
    false,
  )
})

test('Expo CLI MCP extension dispatches a command and returns its output', async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), 'trippy-expo-mcp-cli-'))
  const entryPoint = join(packageRoot, 'fixture-cli.cjs')

  try {
    await writeFile(
      entryPoint,
      [
        'const [, , command, rawArgs, metroServerOrigin] = process.argv;',
        'const args = JSON.parse(rawArgs);',
        "process.stdout.write(JSON.stringify([{ type: 'text', text: JSON.stringify({ command, args, metroServerOrigin }), level: 'info' }]));",
      ].join('\n'),
    )

    const plugin = {
      packageName: 'trippy-fixture-plugin',
      packageRoot,
      description: 'Fixture de contrato MCP',
      cliExtensions: {
        description: 'Comandos de teste',
        entryPoint: 'fixture-cli.cjs',
        commands: [
          {
            name: 'search',
            title: 'Buscar lugares',
            environments: ['mcp'],
            parameters: [{ name: 'query', type: 'text', description: 'Texto da busca' }],
          },
          { name: 'save', title: 'Salvar lugar', environments: ['mcp'] },
          { name: 'web_only', title: 'Comando web', environments: ['cli'] },
        ],
      },
    }
    const devServerManager = {
      projectRoot: packageRoot,
      devtoolsPluginManager: { queryPluginsAsync: async () => [plugin] },
      getDefaultDevServer: () => ({ getJsInspectorBaseUrl: () => 'http://127.0.0.1:8081' }),
    }
    const server = new McpServer({ name: 'trippy-cli-extension-test', version: '1.0.0' })

    await withMcpClient(
      server,
      async (client) => {
        const { tools } = await client.listTools()
        const tool = tools.find(({ name }) => name === plugin.packageName)
        assert.ok(tool)
        assert.deepEqual(tool.inputSchema.required, ['parameters'])
        assert.deepEqual(tool.inputSchema.properties.parameters.required, ['command'])
        assert.deepEqual(tool.inputSchema.properties.parameters.properties.command.enum, [
          'search',
          'save',
        ])
        assert.equal(tool.inputSchema.properties.parameters.required.includes('query'), false)

        const result = await client.callTool({
          name: plugin.packageName,
          arguments: { parameters: { command: 'search', query: 'cafes' } },
        })
        assert.equal(result.isError, undefined)
        assert.deepEqual(JSON.parse(result.content[0].text), {
          command: 'search',
          args: { query: 'cafes' },
          metroServerOrigin: 'http://127.0.0.1:8081',
        })

        const invalidEnum = await client.callTool({
          name: plugin.packageName,
          arguments: { parameters: { command: 'web_only' } },
        })
        assert.equal(invalidEnum.isError, true)

        const originalLogError = cliLog.error
        cliLog.error = () => {}
        try {
          const missingParameter = await client.callTool({
            name: plugin.packageName,
            arguments: { parameters: { command: 'search' } },
          })
          assert.equal(missingParameter.isError, true)
          assert.match(missingParameter.content[0].text, /Expected 1 parameter\(s\), but got 0/)
        } finally {
          cliLog.error = originalLogError
        }
      },
      () => addCliMcpCapabilities(server, devServerManager),
    )
  } finally {
    await rm(packageRoot, { recursive: true, force: true })
  }
})
