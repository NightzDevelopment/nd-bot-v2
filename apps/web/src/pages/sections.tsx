import type { ComponentType } from 'react'
import AiPage from './Ai'
import AnalyticsPage from './Analytics'
import AuditPage from './Audit'
import AutomationPage from './Automation'
import CommunityPage from './Community'
import ConfigPage from './Config'
import EconomyPage from './Economy'
import LevelsPage from './Levels'
import MembersPage from './Members'
import ModerationPage from './Moderation'
import TicketsPage from './Tickets'

/**
 * Maps each non-index nav path to its real page component (Phase C). App.tsx
 * renders these under the dashboard layout. The index route (Overview) is wired
 * directly in App.tsx.
 */
export const SECTION_PAGES: Record<string, ComponentType> = {
  moderation: ModerationPage,
  tickets: TicketsPage,
  ai: AiPage,
  economy: EconomyPage,
  levels: LevelsPage,
  community: CommunityPage,
  automation: AutomationPage,
  analytics: AnalyticsPage,
  members: MembersPage,
  config: ConfigPage,
  audit: AuditPage,
}
