import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, ImageUp } from 'lucide-react'

// Reads the patient QR (content "ONCOBRIEF:<patient id>") from the camera or from a photo.
export default function QrScanner({ onResult, onClose }) {
  const ref = useRef(null)
  const [msg, setMsg] = useState('Starting camera…')
  const parse = (text) => (text.startsWith('ONCOBRIEF:') ? text.slice(10) : text).trim()

  useEffect(() => {
    const q = new Html5Qrcode('qr-region')
    ref.current = q
    q.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 },
      (text) => { q.stop().catch(() => {}); onResult(parse(text)) }, () => {})
      .then(() => setMsg('Point the camera at the QR code on the patient card or phone.'))
      .catch(() => setMsg('No camera available here. Upload a photo of the QR code instead.'))
    return () => { if (q.isScanning) q.stop().catch(() => {}) }
  }, [onResult])

  const fromFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      if (ref.current?.isScanning) await ref.current.stop()
      const text = await ref.current.scanFile(f, false)
      onResult(parse(text))
    } catch { setMsg('Could not read a QR code from that image. Try a sharper photo.') }
  }

  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <div role="dialog" aria-label="Scan patient QR" className="panel" style={{ position: 'fixed', zIndex: 61, top: '10vh', left: '50%', transform: 'translateX(-50%)', width: 'min(440px, 94vw)' }}>
        <div className="panel-head"><h2>Scan patient QR</h2><div className="spacer" /><button className="btn ghost" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div id="qr-region" style={{ width: '100%', minHeight: 240, background: 'var(--paper)', borderRadius: 8, overflow: 'hidden' }} />
        <p className="small muted" style={{ margin: '10px 0' }}>{msg}</p>
        <label className="btn"><ImageUp size={16} /> Read QR from a photo<input type="file" accept="image/*" className="sr-only" onChange={fromFile} /></label>
      </div>
    </>
  )
}
