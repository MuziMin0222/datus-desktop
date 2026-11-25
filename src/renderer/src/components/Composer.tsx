import { useEffect, useRef, useState } from 'react'

import type { ChatAgent } from '../chatAgents'

interface Props {
  streaming: boolean
  commands: ChatAgent[]
  onSend: (text: string) => void
  onInsert: (text: string) => void
  onStop: () => void
}

export function Composer({ streaming, commands, onSend, onInsert, onStop }: Props) {
  const [text, setText] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const commandQuery = /^\/([^\s]*)$/.exec(text)?.[1]
  const options =
    commandQuery === undefined
      ? []
      : commands.filter((command) => {
          const normalized = (command.command ?? '').slice(1).toLowerCase()
          const query = commandQuery.toLowerCase()
          return normalized.startsWith(query) || command.label.toLowerCase().includes(query)
        })
  const menuOpen = options.length > 0
  const activeIndex = Math.min(commandIndex, options.length - 1)

  useEffect(() => {
    setCommandIndex(0)
  }, [text])

  function chooseCommand(command: ChatAgent): void {
    if (!command.command) return
    setText(`${command.command} `)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    if (streaming) onInsert(trimmed)
    else onSend(trimmed)
    setText('')
  }

  return (
    <div className="panel relative p-2">
      {menuOpen && (
        <div
          role="listbox"
          aria-label="Slash commands"
          className="absolute bottom-full left-2 right-2 mb-2 max-h-72 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1 shadow-xl"
        >
          {options.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-xs ${
                index === activeIndex ? 'bg-[#16202b] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[#131c25]'
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(command)}
            >
              <span className="w-20 shrink-0 font-medium">{command.command}</span>
              <span>
                <span className="block text-[var(--text)]">{command.label}</span>
                <span className="block text-[var(--muted)]">{command.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="h-24 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
        placeholder={
          streaming ? 'Steer the running turn…' : 'Ask about your data… (Enter to send, Shift+Enter for a new line)'
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (menuOpen) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCommandIndex((index) => Math.min(index + 1, options.length - 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCommandIndex((index) => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              chooseCommand(options[activeIndex])
              return
            }
          }
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
