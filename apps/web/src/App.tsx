import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { DashboardLayout } from './components/layout/DashboardLayout'
import { NAV_SECTIONS } from './nav'
import Overview from './pages/Overview'
import { NotFound } from './pages/NotFound'
import { Login } from './pages/Login'
import { SECTION_PAGES } from './pages/sections'
import { api, ApiError } from './lib/api'
import { captureTokenFromHash, logout } from './lib/auth'

/** What we know about the session while/after validating the token. */
type AuthState =
  | { status: 'loading' }
  | { status: 'authed' }
  | { status: 'anon' }

/**
 * App shell. On load we lift any `#token=` from the OAuth redirect into storage,
 * then validate it against `/api/auth/me`. With no/invalid token we render the
 * Login screen; otherwise the dashboard router. A 401 sends the user back to
 * Login (and clears the dead token).
 */
export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    const token = captureTokenFromHash()
    if (!token) {
      setAuth({ status: 'anon' })
      return
    }

    let cancelled = false
    api
      .get<{ auth: { userId: string | null; isAdmin: boolean } }>('/auth/me')
      .then((res) => {
        if (cancelled) return
        if (res.auth.userId) setAuth({ status: 'authed' })
        else {
          logout()
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          logout()
          return
        }
        // Network or transient error: trust the stored token rather than locking
        // the user out, so the dashboard still loads if /auth/me is briefly down.
        setAuth({ status: 'authed' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (auth.status === 'loading') {
    return (
      <main className="flex min-h-full items-center justify-center bg-sentinel-bg">
        <p className="text-[11px] uppercase tracking-[0.18em] text-sentinel-muted">Loading</p>
      </main>
    )
  }

  if (auth.status === 'anon') return <Login />

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<Overview />} />
        {NAV_SECTIONS.filter((section) => section.path !== '').map((section) => {
          const Page = SECTION_PAGES[section.path]
          if (!Page) return null
          return <Route key={section.path} path={section.path} element={<Page />} />
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
