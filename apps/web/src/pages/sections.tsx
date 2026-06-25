import type { ComponentType } from 'react'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'
import { NAV_SECTIONS } from '../nav'

/**
 * Builds one placeholder page component per non-index nav section, keyed by
 * path. App.tsx maps these into routes. Each renders a titled Panel with the
 * section blurb, ready for a Phase C page to replace it.
 */
function makeSectionPage(label: string, blurb: string): ComponentType {
  const Page = () => <PlaceholderPage title={label} blurb={blurb} />
  Page.displayName = `Section(${label})`
  return Page
}

export const SECTION_PAGES: Record<string, ComponentType> = Object.fromEntries(
  NAV_SECTIONS.filter((section) => section.path !== '').map((section) => [
    section.path,
    makeSectionPage(section.label, section.blurb),
  ]),
)
