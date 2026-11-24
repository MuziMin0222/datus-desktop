import { useState } from 'react'

interface Props {
  streaming: boolean
  onSend: (text: string) => void
  onInsert: (text: string) => void
  onStop: () => void
}

export function Composer({ streaming, onSend, onInsert, onStop }: Props) {
  const [text, setText] = useState('')

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    if (streaming) onInsert(trimmed)
    else onSend(trimmed)
    setText('')
  }

  return (
    <div className="panel p-2">
      <textarea
        className="h-24 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
        placeholder={
          streaming ? 'Steer the running turn…' : 'Ask about your data… (Enter to send, Shift+Enter for a new line)'
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-end gap-2 px-1">
        {streaming && (
          <button className="btn" onClick={onStop}>
            Stop
          </button>
        )}
        <button className="btn btn-primary" onClick={submit} disabled={!text.trim()}>
          {streaming ? 'Insert' : 'Send'}
        </button>
      </div>
    </div>
  )
}
