/**
 * Retrieval over the knowledge_docs table. When a doc has a stored embedding
 * array and a query embedding is supplied, rank by cosine similarity. Otherwise
 * fall back to a keyword overlap score on title + content.
 */
import { getDb, schema } from '@nd/db'

export interface KnowledgeDoc {
  id: number
  source: string
  title: string
  content: string
  embedding: number[] | null
  updatedAt: number
}

export interface RetrieveOptions {
  /** When provided, enables cosine ranking over docs that carry embeddings. */
  queryEmbedding?: number[] | undefined
  /** Restrict to a single source bucket (rules | faq | fivem | store | custom). */
  source?: string | undefined
}

export interface ScoredDoc extends KnowledgeDoc {
  score: number
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    magA += av * av
    magB += bv * bv
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
}

/** Keyword overlap: fraction of query tokens present in the doc text. */
function keywordScore(queryTokens: string[], doc: KnowledgeDoc): number {
  if (queryTokens.length === 0) return 0
  const haystack = new Set(tokenize(`${doc.title} ${doc.content}`))
  let hits = 0
  for (const token of queryTokens) {
    if (haystack.has(token)) hits++
  }
  return hits / queryTokens.length
}

function normalizeEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw) && raw.every((v) => typeof v === 'number')) {
    return raw as number[]
  }
  return null
}

/**
 * Retrieve the top k knowledge docs for a query. Embedding ranking is used for
 * docs that have embeddings when queryEmbedding is given; remaining docs (and
 * the no-embedding path) are ranked by keyword overlap.
 */
export async function retrieve(
  query: string,
  k = 4,
  opts: RetrieveOptions = {},
): Promise<ScoredDoc[]> {
  const db = getDb()
  const rows = await db.select().from(schema.knowledgeDocs)

  const docs: KnowledgeDoc[] = rows
    .filter((r) => (opts.source ? r.source === opts.source : true))
    .map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      content: r.content,
      embedding: normalizeEmbedding(r.embedding),
      updatedAt: r.updatedAt,
    }))

  const queryTokens = tokenize(query)

  const scored: ScoredDoc[] = docs.map((doc) => {
    let score: number
    if (opts.queryEmbedding && doc.embedding) {
      score = cosine(opts.queryEmbedding, doc.embedding)
    } else {
      score = keywordScore(queryTokens, doc)
    }
    return { ...doc, score }
  })

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
