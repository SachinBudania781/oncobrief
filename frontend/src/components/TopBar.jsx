import { NavLink, Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#5B3F92" />
      <path d="M11 23c3-4 5-8 5-12a3 3 0 0 0-6 0c0 4 4 8 11 13" fill="none" stroke="#F3B44A" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default function TopBar({ app, children }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand"><Logo /> OncoBrief <span className="app">{app}</span></Link>
      <nav className="appswitch" aria-label="Switch app">
        <NavLink to="/doctor">Doctor</NavLink>
        <NavLink to="/staff">Staff</NavLink>
        <NavLink to="/patient">Patient</NavLink>
      </nav>
      <Link className="round2-switch" to="/app" aria-label="Return to the Round 2 workspace" title="Return to the Round 2 workspace">
        <span>Round 2 workspace</span><ArrowRight size={15} />
      </Link>
      <div className="spacer" />
      {children}
      <span className="demo-flag">Prototype · fabricated patients only</span>
    </header>
  )
}
