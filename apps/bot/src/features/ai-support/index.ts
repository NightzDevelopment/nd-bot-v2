/**
 * ai-support feature wiring.
 *
 * `setupAiSupport()` is called once from the central registry during
 * integration. It:
 *   1. registers the AiSupportService on the Sapphire container so commands and
 *      the messageCreate listener share one instance,
 *   2. registers dashboard API routes for the knowledge base (list / add /
 *      remove) and a recent-activity feed, on container.api.router (guarded),
 *   3. there is no background resume loop for this feature.
 *
 * The service depends on the Discord client, which is available on the global
 * container by the time setup runs (after the client is constructed).
 */
import { container } from '@sapphire/framework'
import { and, desc, eq, like } from 'drizzle-orm'
import { getDb, schema } from '@nd/db'
import { json, problem } from '../../api/server.ts'
import { AiSupportService } from './service.ts'

declare module '@sapphire/pieces' {
  interface Container {
    /** The agentic AI support assistant service. */
    aiSupport: AiSupportService
  }
}

export { AiSupportService } from './service.ts'

const KNOWN_SOURCES = new Set(['rules', 'faq', 'fivem', 'store', 'custom'])

/** Register the service and dashboard API routes for ai-support. */
export function setupAiSupport(): void {
  container.aiSupport = new AiSupportService(container.client)

  const router = container.api?.router
  if (!router) {
    container.logger.warn('ai-support: api router unavailable, skipping route registration')
    return
  }

  // List knowledge docs, optionally filtered by ?source= and ?q= search.
  router.get('/api/ai/knowledge', async ({ url }) => {
    const db = getDb()
    const source = url.searchParams.get('source')
    const q = url.searchParams.get('q')?.trim()

    const filters = []
    if (source && KNOWN_SOURCES.has(source)) filters.push(eq(schema.knowledgeDocs.source, source))
    if (q) filters.push(like(schema.knowledgeDocs.title, `%${q}%`))

    const where = filters.length === 1 ? filters[0] : filters.length > 1 ? and(...filters) : undefined

    const base = db
      .select({
        id: schema.knowledgeDocs.id,
        source: schema.knowledgeDocs.source,
        title: schema.knowledgeDocs.title,
        content: schema.knowledgeDocs.content,
        updatedAt: schema.knowledgeDocs.updatedAt,
      })
      .from(schema.knowledgeDocs)
      .orderBy(desc(schema.knowledgeDocs.updatedAt))
      .limit(200)

    const rows = where ? await base.where(where) : await base
    return json({ docs: rows })
  })

  // Create a knowledge doc (admin only).
  router.post(
    '/api/ai/knowledge',
    async ({ req }) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return problem(400, 'invalid json body')
      }
      const parsed = parseDocBody(body)
      if (!parsed) return problem(400, 'source, title, and content are required')

      const db = getDb()
      const inserted = await db
        .insert(schema.knowledgeDocs)
        .values({ ...parsed, updatedAt: Date.now() })
        .returning({ id: schema.knowledgeDocs.id })

      const id = inserted[0]?.id
      container.api?.hub.broadcast('ai', 'kb_added', { id, source: parsed.source, title: parsed.title })
      return json({ id, ...parsed }, { status: 201 })
    },
    { requireAdmin: true },
  )

  // Delete a knowledge doc by id (admin only).
  router.register(
    'DELETE',
    '/api/ai/knowledge/:id',
    async ({ params }) => {
      const id = Number(params.id)
      if (!Number.isInteger(id) || id < 1) return problem(400, 'invalid id')

      const db = getDb()
      const deleted = await db
        .delete(schema.knowledgeDocs)
        .where(eq(schema.knowledgeDocs.id, id))
        .returning({ id: schema.knowledgeDocs.id })

      if (deleted.length === 0) return problem(404, 'not found')
      container.api?.hub.broadcast('ai', 'kb_removed', { id })
      return json({ ok: true })
    },
    { requireAdmin: true },
  )

  // Recent AI activity feed for the dashboard, derived from analytics events.
  router.get('/api/ai/activity', async ({ url }) => {
    const guildId = url.searchParams.get('guildId')
    const db = getDb()
    const base = db
      .select({
        id: schema.analyticsEvents.id,
        guildId: schema.analyticsEvents.guildId,
        userId: schema.analyticsEvents.userId,
        channelId: schema.analyticsEvents.channelId,
        createdAt: schema.analyticsEvents.createdAt,
      })
      .from(schema.analyticsEvents)
      .orderBy(desc(schema.analyticsEvents.createdAt))
      .limit(50)

    const rows = guildId
      ? await base.where(and(eq(schema.analyticsEvents.type, 'ai'), eq(schema.analyticsEvents.guildId, guildId)))
      : await base.where(eq(schema.analyticsEvents.type, 'ai'))

    return json({ events: rows })
  })

  container.logger.info('ai-support: service and API routes registered')
}

interface DocBody {
  source: string
  title: string
  content: string
}

/** Validate a knowledge-doc request body without throwing. */
function parseDocBody(body: unknown): DocBody | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const source = typeof record.source === 'string' ? record.source.toLowerCase() : 'custom'
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  if (!title || !content) return null
  return { source: KNOWN_SOURCES.has(source) ? source : 'custom', title, content }
}
