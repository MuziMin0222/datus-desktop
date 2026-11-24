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
      json(response, {
        success: true,
        data: {
          target: 'mock_model',
          models: { mock_model: { type: 'openai', model: 'mock-model' } },
          datasources: { demo: { type: 'sqlite' } },
          current_datasource: 'demo',
          home: '/tmp/datus-e2e'
        }
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
})
