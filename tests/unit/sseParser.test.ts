import { describe, expect, it } from 'vitest'

import { SSEParser, decodeFrame } from '../../src/renderer/src/api/sse'

describe('SSEParser', () => {
  it('parses a complete frame', () => {
    const parser = new SSEParser()
    const frames = parser.push('id: 7\nevent: message\ndata: {"a":1}\n\n')
    expect(frames).toEqual([{ id: 7, event: 'message', data: '{"a":1}' }])
  })

  it('reassembles frames split across chunks', () => {
    const parser = new SSEParser()
    expect(parser.push('id: 1\nev')).toEqual([])
    expect(parser.push('ent: mess')).toEqual([])
    expect(parser.push('age\ndata: hello\n')).toEqual([])
    expect(parser.push('\n')).toEqual([{ id: 1, event: 'message', data: 'hello' }])
  })

  it('normalises CRLF line endings', () => {
    const parser = new SSEParser()
    const frames = parser.push('id: 2\r\nevent: ping\r\ndata:\r\n\r\n')
    expect(frames).toEqual([{ id: 2, event: 'ping', data: '' }])
  })

  it('joins multi-line data payloads', () => {
    const parser = new SSEParser()
    const frames = parser.push('data: first\ndata: second\n\n')
    expect(frames[0].data).toBe('first\nsecond')
  })

  it('ignores comment-only frames', () => {
    const parser = new SSEParser()
    expect(parser.push(':\n\n')).toEqual([])
  })

  it('parses several frames from one chunk', () => {
    const parser = new SSEParser()
    const frames = parser.push('id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c\n\n')
    expect(frames.map((frame) => frame.data)).toEqual(['a', 'b', 'c'])
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3])
  })

  it('keeps a partial frame buffered', () => {
    const parser = new SSEParser()
    parser.push('id: 4\ndata: partial')
    expect(parser.pending).toBe('id: 4\ndata: partial')
  })

  it('ignores invalid ids but keeps the frame', () => {
    const parser = new SSEParser()
    const frames = parser.push('id: -1\nevent: ping\ndata: x\n\n')
    expect(frames).toEqual([{ id: undefined, event: 'ping', data: 'x' }])
  })
})

describe('decodeFrame', () => {
  it('parses JSON data', () => {
    expect(decodeFrame({ id: 1, event: 'message', data: '{"ok":true}' })).toEqual({
      id: 1,
      event: 'message',
      data: { ok: true }
    })
  })

  it('falls back to the raw string', () => {
    expect(decodeFrame({ event: 'message', data: 'not-json' }).data).toBe('not-json')
  })

  it('maps empty data to null', () => {
    expect(decodeFrame({ id: 3, event: 'ping', data: '' }).data).toBeNull()
  })
})
