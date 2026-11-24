import { useCallback, useEffect, useState } from 'react'

import type { BootstrapSnapshot, SidecarStatus } from '@shared/ipc'
import { ChatView } from './components/ChatView'
import { Onboarding } from './components/Onboarding'

export default function App() {
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null)
  const [forceSetup, setForceSetup] = useState(false)

  const refresh = useCallback(async () => {
    setSnapshot(await window.datus.getState())
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.datus.onStatus((status: SidecarStatus) => {
      setSnapshot((previous) => {
        if (!previous) return previous
        if (previous.settings.mode !== 'local') return { ...previous, status }
        return {
          ...previous,
          status,
          connection: {
            ...previous.connection,
            baseUrl: status.baseUrl ?? previous.connection.baseUrl,
            ready: status.state === 'ready',
            version: status.version ?? previous.connection.version
          }
        }
      })
    })
    return unsubscribe
  }, [refresh])

  if (!snapshot) return <div className="boot">Loading Datus Desktop…</div>

  const ready = Boolean(snapshot.connection.baseUrl && snapshot.connection.ready)
  if (forceSetup || !ready) {
    return <Onboarding snapshot={snapshot} onRefresh={refresh} onConnected={() => setForceSetup(false)} />
  }
  return <ChatView snapshot={snapshot} onRefresh={refresh} onReconfigure={() => setForceSetup(true)} />
}
