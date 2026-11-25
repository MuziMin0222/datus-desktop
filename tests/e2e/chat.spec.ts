import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

interface SSESpec {
  id: number
  event: string
  data: unknown
}

interface AgentConfigFixture {
  target: string
  target_provider?: string
  target_model?: string
  models: Record<string, { type: string; model: string }>
  datasources: Record<string, { type: string; default?: boolean }>
  current_datasource: string
  home: string
}

interface ModelUpdate {
  models?: AgentConfigFixture['models']
  target?: string | null
}

interface DatasourceUpdate {
  datasources: AgentConfigFixture['datasources']
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*'
  }
}

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sse(response: ServerResponse, frames: SSESpec[]): void {
  response.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  for (const frame of frames) {
    response.write(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
  }
  response.end()
}

function messageFrame(
  id: number,
  op: 'createMessage' | 'appendMessage',
  messageId: string,
  content: { type: string; payload: Record<string, unknown> }[]
): SSESpec {
  return {
    id,
    event: 'message',
    data: { type: op, payload: { message_id: messageId, role: 'assistant', content } }
  }
}

const CHAT_FRAMES: SSESpec[] = [
  { id: 1, event: 'session', data: { session_id: 'e2e-session', run_id: 'e2e-run' } },
  messageFrame(2, 'createMessage', 'm1', [{ type: 'markdown', payload: { content: 'Hello ' } }]),
  messageFrame(3, 'appendMessage', 'm1', [{ type: 'markdown', payload: { content: 'from the mock agent.' } }]),
  messageFrame(4, 'createMessage', 'm2', [
    {
      type: 'call-tool',
      payload: { callToolId: 'tc1', toolName: 'execute_sql', toolParams: { sql: 'SELECT 1' }, proxied: false }
    }
  ]),
  messageFrame(5, 'createMessage', 'm3', [
    {
      type: 'call-tool-result',
      payload: { callToolId: 'tc1', toolName: 'execute_sql', duration: 0.1, shortDesc: '1 row', result: { rows: 1 } }
    }
  ]),
  { id: 6, event: 'usage', data: { session_total_tokens: 42, context_length: 512 } },
  { id: 7, event: 'end', data: { session_id: 'e2e-session' } }
]

let server: Server
let app: ElectronApplication
let page: Page
let baseUrl: string
let modelUpdates: ModelUpdate[] = []
let datasourceUpdates: DatasourceUpdate[] = []
let failedConfigUpdate: 'models' | 'datasources' | null = null
let agentConfig: AgentConfigFixture = {
  target: 'mock_model',
  models: {
    mock_model: { type: 'openai', model: 'mock-model' },
    secondary_model: { type: 'deepseek', model: 'secondary-model' }
  },
  datasources: {
    demo: { type: 'sqlite' },
    analytics: { type: 'duckdb' }
  },
  current_datasource: 'demo',
  home: '/tmp/datus-e2e'
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', baseUrl)

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders())
      response.end()
      return
    }

    if (url.pathname === '/health/live') {
      json(response, { status: 'ok', ready: true, version: '0.4.5-e2e' })
      return
    }
    if (url.pathname === '/api/v1/chat/sessions') {
      json(response, { success: true, data: { sessions: [], total_count: 0 } })
      return
    }
    if (url.pathname === '/api/v1/config/agent') {
      json(response, { success: true, data: agentConfig })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/v1/config/models') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const update = JSON.parse(body) as ModelUpdate
        modelUpdates.push(update)
        if (failedConfigUpdate === 'models') {
          json(response, { success: false, errorMessage: 'model delete failed' }, 500)
          return
        }
        if (update.models) agentConfig.models = update.models
        if ('target' in update) {
          agentConfig.target = update.target ?? ''
          delete agentConfig.target_provider
          delete agentConfig.target_model
        }
        json(response, { success: true, data: { updated: true } })
      })
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/v1/config/datasources') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const update = JSON.parse(body) as DatasourceUpdate
        datasourceUpdates.push(update)
        if (failedConfigUpdate === 'datasources') {
          json(response, { success: false, errorMessage: 'datasource delete failed' }, 500)
          return
        }
        agentConfig.datasources = update.datasources
        if (!Object.hasOwn(update.datasources, agentConfig.current_datasource)) {
          agentConfig.current_datasource =
            Object.entries(update.datasources).find(([, config]) => config.default)?.[0] ??
            Object.keys(update.datasources)[0] ??
            ''
        }
        json(response, { success: true, data: { updated: true } })
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/chat/stream') {
      request.resume()
      sse(response, CHAT_FRAMES)
      return
    }
    if (request.method === 'DELETE') {
      json(response, { success: true, data: {} })
      return
    }
    json(response, { success: true, data: {} })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`

  const userData = mkdtempSync(join(tmpdir(), 'datus-desktop-e2e-'))
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      settings: {
        mode: 'remote',
        workspace: null,
        permissionProfile: 'auto',
        remote: { baseUrl, allowInsecureTls: false }
      }
    })
  )

  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      DATUS_DESKTOP_USER_DATA: userData,
      DATUS_DESKTOP_DISABLE_UPDATES: '1'
    }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  server?.closeAllConnections?.()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

test.afterEach(async () => {
  const close = page.getByRole('button', { name: 'Close', exact: true })
  if (await close.isVisible()) await close.click()
})

test.beforeEach(() => {
  modelUpdates = []
  datasourceUpdates = []
  failedConfigUpdate = null
  agentConfig = {
    target: 'mock_model',
    models: {
      mock_model: { type: 'openai', model: 'mock-model' },
      secondary_model: { type: 'deepseek', model: 'secondary-model' }
    },
    datasources: {
      demo: { type: 'sqlite' },
      analytics: { type: 'duckdb' }
    },
    current_datasource: 'demo',
    home: '/tmp/datus-e2e'
  }
})

test('connects to a remote backend and completes a scripted chat turn', async () => {
  const composer = page.getByPlaceholder(/Ask about your data/)
  await expect(composer).toBeVisible({ timeout: 30_000 })

  await composer.fill('How many schools are there?')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText('Hello from the mock agent.')).toBeVisible()
  const toolSummary = page.locator('summary', { hasText: 'execute_sql' })
  await expect(toolSummary).toBeVisible()
  await toolSummary.click()
  await expect(page.getByText('1 row')).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models' }).click()
  await expect(page.getByText('mock_model', { exact: true })).toBeVisible()
  await expect(page.getByText('active', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Datasources' }).click()
  await expect(page.getByText('demo', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Updates' }).click()
  await expect(page.getByText(/Development builds do not auto-update/)).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
})

test('model selection reports the active choice and switches targets', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()

  const activeModel = page.getByLabel('Activate mock_model')
  const secondaryModel = page.getByLabel('Activate secondary_model')
  await expect(activeModel).toBeChecked()
  await expect(secondaryModel).not.toBeChecked()

  await activeModel.click()
  await expect(activeModel).toBeChecked()
  await expect(page.getByRole('status')).toHaveText('"mock_model" is already the active model.')

  await secondaryModel.click()
  await expect(secondaryModel).toBeChecked()
  await expect(activeModel).not.toBeChecked()
  await expect(page.getByText('Active model: secondary_model')).toBeVisible()
})

test('deletes the active model and the last remaining model', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete mock_model', exact: true }).click()

  await expect(page.getByText('mock_model', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Activate secondary_model')).toBeChecked()
  await expect(page.getByRole('status')).toHaveText('Deleted model "mock_model".')
  expect(modelUpdates.at(-1)).toEqual({
    models: { secondary_model: { type: 'deepseek', model: 'secondary-model' } },
    target: 'secondary_model'
  })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete secondary_model', exact: true }).click()

  await expect(page.getByText('No models configured yet. Add one to start chatting.')).toBeVisible()
  await expect(page.getByText(/Active target: none/)).toBeVisible()
  expect(modelUpdates.at(-1)).toEqual({ models: {}, target: null })
})

test('deletes the active datasource and the last remaining datasource', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Datasources', exact: true }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete demo', exact: true }).click()

  await expect(page.getByText('demo', { exact: true })).toHaveCount(0)
  await expect(page.getByText('analytics', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Deleted datasource "demo".')
  expect(agentConfig.datasources).toEqual({ analytics: { type: 'duckdb', default: true } })
  expect(agentConfig.current_datasource).toBe('analytics')
  expect(datasourceUpdates.at(-1)).toEqual({
    datasources: { analytics: { type: 'duckdb', default: true } }
  })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete analytics', exact: true }).click()

  await expect(page.getByText('No datasources configured.')).toBeVisible()
  await expect(page.getByText(/Active: none/)).toBeVisible()
  expect(agentConfig.datasources).toEqual({})
  expect(agentConfig.current_datasource).toBe('')
  expect(datasourceUpdates.at(-1)).toEqual({ datasources: {} })
})

test('deletes inactive entries without changing the active choices', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete secondary_model', exact: true }).click()

  await expect(page.getByText('secondary_model', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Activate mock_model')).toBeChecked()
  expect(agentConfig.target).toBe('mock_model')
  expect(modelUpdates.at(-1)).toEqual({
    models: { mock_model: { type: 'openai', model: 'mock-model' } }
  })

  await page.getByRole('button', { name: 'Datasources', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete analytics', exact: true }).click()

  await expect(page.getByText('analytics', { exact: true })).toHaveCount(0)
  await expect(page.getByText('demo', { exact: true })).toBeVisible()
  expect(agentConfig.current_datasource).toBe('demo')
  expect(datasourceUpdates.at(-1)).toEqual({ datasources: { demo: { type: 'sqlite' } } })
})

test('deleting a custom model preserves the active provider model', async () => {
  agentConfig.target = ''
  agentConfig.target_provider = 'openai'
  agentConfig.target_model = 'provider-model'
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()

  await expect(page.getByText(/Active target: openai\/provider-model/)).toBeVisible()
  await expect(page.getByLabel('Activate mock_model')).not.toBeChecked()
  await expect(page.getByLabel('Activate secondary_model')).not.toBeChecked()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete mock_model', exact: true }).click()

  await expect(page.getByText('mock_model', { exact: true })).toHaveCount(0)
  expect(modelUpdates.at(-1)).toEqual({
    models: { secondary_model: { type: 'deepseek', model: 'secondary-model' } }
  })
  expect(agentConfig.target_provider).toBe('openai')
  expect(agentConfig.target_model).toBe('provider-model')
})

test('cancelling deletion keeps models and datasources', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete mock_model', exact: true }).click()

  await expect(page.getByText('mock_model', { exact: true })).toBeVisible()
  expect(modelUpdates).toEqual([])

  await page.getByRole('button', { name: 'Datasources', exact: true }).click()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete demo', exact: true }).click()

  await expect(page.getByText('demo', { exact: true })).toBeVisible()
  expect(datasourceUpdates).toEqual([])
})

test('failed deletion reports errors and keeps models and datasources', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Models', exact: true }).click()
  failedConfigUpdate = 'models'

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete mock_model', exact: true }).click()

  await expect(page.getByRole('alert')).toHaveText('model delete failed')
  await expect(page.getByText('mock_model', { exact: true })).toBeVisible()
  expect(agentConfig.target).toBe('mock_model')

  await page.getByRole('button', { name: 'Datasources', exact: true }).click()
  failedConfigUpdate = 'datasources'
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete demo', exact: true }).click()

  await expect(page.getByRole('alert')).toHaveText('datasource delete failed')
  await expect(page.getByText('demo', { exact: true })).toBeVisible()
  expect(agentConfig.current_datasource).toBe('demo')
})
