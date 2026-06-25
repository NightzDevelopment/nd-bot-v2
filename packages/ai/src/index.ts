/**
 * @nd/ai: multi-provider AI layer (Gemini + Claude) with routing, fallback,
 * cache, telemetry, an agentic tool loop, per-user memory, and RAG.
 *
 * SCAFFOLD: interfaces are the contract; the build phase implements the bodies.
 */

export type ProviderName = 'gemini' | 'claude'
export type ProviderMode = 'auto' | ProviderName

export interface GenerateOptions {
  system?: string
  /** prior turns for context (role + content) */
  history?: { role: 'user' | 'model'; content: string }[]
  prompt: string
  /** routing hint; 'auto' lets the router pick per intent */
  mode?: ProviderMode
  intent?: string
  maxTokens?: number
}

export interface GenerateResult {
  text: string
  provider: ProviderName
  model: string
  cached: boolean
}

export interface AIProvider {
  name: ProviderName
  generate(opts: GenerateOptions): Promise<GenerateResult>
}

/** A tool the agent can call. */
export interface AgentTool<Args = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
  execute(args: Args): Promise<unknown>
}

export interface AgentOptions extends GenerateOptions {
  tools?: AgentTool[]
  maxIterations?: number
}

// ---- Implementations ------------------------------------------------------

export { getRouter, routeIntent, type Router } from './router.ts'
export { runAgent, type AgentResult } from './agent.ts'
export {
  retrieve,
  type KnowledgeDoc,
  type RetrieveOptions,
  type ScoredDoc,
} from './rag.ts'
export {
  remember,
  recall,
  recallForGuild,
  type MemoryRole,
  type MemoryTurn,
  type RememberOptions,
} from './memory.ts'
export { geminiProvider } from './providers/gemini.ts'
export { claudeProvider } from './providers/claude.ts'
export { clearCache, cacheKey } from './cache.ts'
export { recordTelemetry, type TelemetryRecord } from './telemetry.ts'

export const AI_SCAFFOLD = true
