import { Route, Routes } from 'react-router-dom'
import { DashboardLayout } from './components/layout/DashboardLayout'
import { NAV_SECTIONS } from './nav'
import { Overview } from './pages/Overview'
import { NotFound } from './pages/NotFound'
import { SECTION_PAGES } from './pages/sections'

/**
 * App router. The persistent DashboardLayout (sidebar + topbar) wraps every
 * section. Routes are derived from NAV_SECTIONS so a new section needs only a
 * nav entry plus (optionally) a dedicated page in SECTION_PAGES.
 */
export function App() {
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
