import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/**
 * Persistent application shell: fixed sidebar + topbar, scrollable content.
 * Every dashboard route renders into the Outlet.
 */
export function DashboardLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-sentinel-bg text-sentinel-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
