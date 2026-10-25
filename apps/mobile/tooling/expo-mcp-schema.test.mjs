import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addMcpCapabilities } from 'expo-mcp';
import { z } from 'zod';

const requireFromMobile = createRequire(import.meta.url);
const expoMcpEntry = requireFromMobile.resolve('expo-mcp');
const requireFromExpoMcp = createRequire(expoMcpEntry);
const mcpTunnelEntry = requireFromExpoMcp.resolve('@expo/mcp-tunnel');
const { TunnelMcpServerProxy } = await import(pathToFileURL(mcpTunnelEntry).href);
const expoEntry = requireFromMobile.resolve('expo');
const cliPackageJson = createRequire(expoEntry).resolve('@expo/cli/package.json');
const requireFromCli = createRequire(cliPackageJson);
const cliRoot = dirname(cliPackageJson);
const { createMCPDevToolsExtensionSchema } = requireFromCli(
  join(cliRoot, 'build/src/start/server/createMCPDevToolsExtensionSchema.js'),
);
const { PluginSchema } = requireFromCli(join(cliRoot, 'build/src/start/server/DevToolsPlugin.schema.js'));

const silentLogger = Object.fromEntries(
  ['debug', 'log', 'info', 'warn', 'error', 'time', 'timeEnd'].map((method) => [method, () => {}]),
);

function createProxy() {
  return new TunnelMcpServerProxy('wss://127.0.0.1:1', {
    projectRoot: process.cwd(),
    devServerUrl: 'http://127.0.0.1:8081',
    logger: silentLogger,
  });
}

test('Expo MCP resolves the patched tunnel with Zod 4 support', () => {
  assert.equal(mcpTunnelEntry, requireFromMobile.resolve('@expo/mcp-tunnel'));
  assert.equal(typeof requireFromExpoMcp('zod').toJSONSchema, 'function');
});

test('Expo MCP publishes required, enum, optional and nested tool arguments', () => {
  const proxy = createProxy();
  const shape = {
    placeName: z.string(),
    source: z.enum(['geoapify', 'manual']),
    note: z.string().optional(),
    location: z.object({
      latitude: z.number(),
      region: z.enum(['north', 'south']),
    }),
  };

  proxy.registerTool('save_place', { inputSchema: shape }, async () => ({ content: [] }));

  const schema = proxy.getRegisteredTools().get('save_place')?.inputSchema;
  assert.ok(schema);
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['placeName', 'source', 'location']);
  assert.deepEqual(schema.properties.source.enum, ['geoapify', 'manual']);
  assert.equal(schema.properties.note.type, 'string');
  assert.equal(schema.required.includes('note'), false);
  assert.deepEqual(schema.properties.location.required, ['latitude', 'region']);
  assert.deepEqual(schema.properties.location.properties.region.enum, ['north', 'south']);

  const input = z.object(shape);
  assert.equal(
    input.safeParse({
      placeName: 'Jardim Botânico',
      source: 'geoapify',
      location: { latitude: -25.44, region: 'south' },
    }).success,
    true,
  );
  assert.equal(
    input.safeParse({
      placeName: 'Jardim Botânico',
      source: 'google',
      location: { latitude: -25.44, region: 'west' },
    }).success,
    false,
  );
});

test('Expo MCP publishes required and optional prompt arguments', () => {
  const proxy = createProxy();
  proxy.registerPrompt(
    'plan_trip',
    {
      argsSchema: {
        destination: z.enum(['Lisboa', 'Curitiba']),
        tone: z.string().optional(),
      },
    },
    async () => ({ description: 'Plano da viagem', messages: [] }),
  );

  const schema = proxy.getRegisteredPrompts().get('plan_trip')?.argsSchema;
  assert.ok(schema);
  assert.deepEqual(schema.required, ['destination']);
  assert.deepEqual(schema.properties.destination.enum, ['Lisboa', 'Curitiba']);
  assert.equal(schema.required.includes('tone'), false);
});

test('Expo MCP tool schemas survive registration through the CLI tunnel', () => {
  const proxy = createProxy();
  const rawSchemas = new Map();
  const server = {
    devServerUrl: proxy.devServerUrl,
    registerTool(name, config, callback) {
      rawSchemas.set(name, config.inputSchema);
      proxy.registerTool(name, config, callback);
    },
    registerPrompt: proxy.registerPrompt,
    registerResource: proxy.registerResource,
  };

  addMcpCapabilities(server, process.cwd());

  const openDevtools = proxy.getRegisteredTools().get('open_devtools')?.inputSchema;
  assert.ok(openDevtools);
  assert.deepEqual(openDevtools.required, ['projectRoot']);
  assert.deepEqual(openDevtools.properties.platform.enum, ['android', 'ios']);
  assert.equal(openDevtools.required.includes('platform'), false);
  assert.equal(
    z.object(rawSchemas.get('open_devtools')).safeParse({ projectRoot: '/tmp/trippy', platform: 'ios' })
      .success,
    true,
  );
  assert.equal(
    z.object(rawSchemas.get('open_devtools')).safeParse({ projectRoot: '/tmp/trippy', platform: 'web' })
      .success,
    false,
  );

  const collectLogs = proxy.getRegisteredTools().get('collect_app_logs')?.inputSchema;
  assert.ok(collectLogs);
  assert.deepEqual(collectLogs.required, ['projectRoot']);
  assert.deepEqual(collectLogs.properties.sources.items.enum, [
    'native_android',
    'native_ios',
    'js_console',
  ]);
  const defaults = z.object(rawSchemas.get('collect_app_logs')).safeParse({ projectRoot: '/tmp/trippy' });
  assert.equal(defaults.success, true);
  assert.deepEqual(defaults.data.sources, ['js_console']);
  assert.equal(defaults.data.durationMs, 2000);
  assert.equal(
    z.object(rawSchemas.get('collect_app_logs'))
      .safeParse({ projectRoot: '/tmp/trippy', sources: ['unknown'] }).success,
    false,
  );
});

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
  });

  assert.equal(schema.safeParse({ command: 'search', query: 'cafe' }).success, true);
  assert.equal(schema.safeParse({ command: 'delete' }).success, false);

  const jsonSchema = z.toJSONSchema(schema);
  assert.deepEqual(jsonSchema.required, ['command']);
  assert.deepEqual(jsonSchema.properties.command.enum, ['search', 'save']);
  assert.equal(jsonSchema.properties.query.type, 'string');
  assert.equal(jsonSchema.required.includes('query'), false);
});

test('Expo CLI validates MCP plugin required fields and enums', () => {
  const plugin = {
    packageName: '@trippy/example-plugin',
    packageRoot: '/tmp/example-plugin',
    cliExtensions: {
      description: 'Ferramentas de exemplo',
      entryPoint: 'index.js',
      commands: [{ name: 'search', title: 'Buscar', environments: ['mcp'] }],
    },
  };

  assert.equal(PluginSchema.safeParse(plugin).success, true);
  assert.equal(
    PluginSchema.safeParse({
      ...plugin,
      cliExtensions: {
        ...plugin.cliExtensions,
        commands: [{ name: 'search', title: 'Buscar', environments: ['web'] }],
      },
    }).success,
    false,
  );
});
