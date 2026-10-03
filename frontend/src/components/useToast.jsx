import { useCallback, useRef, useState } from 'react'

export default function useToast() {
  const [msg, setMsg] = useState('')
  const t = useRef(null)
  const show = useCallback((m) => {
    setMsg(m)
    clearTimeout(t.current)
    t.current = setTimeout(() => setMsg(''), 3200)
  }, [])
  const node = msg ? <div className="toast" role="status">{msg}</div> : null
  return [show, node]
}
