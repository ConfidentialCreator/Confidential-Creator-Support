import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '../api/health.ts'
import { webEnv } from '../config.ts'

export function ApiStatus() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetchHealth(webEnv.apiUrl) })

  if (health.isPending) return <span>api · …</span>
  if (health.isError) return <span className="text-refused">api offline</span>
  if (!health.data.ok) return <span className="text-refused">api · rpc down</span>
  return <span>api · slot {health.data.slot.toLocaleString('en-US')}</span>
}
