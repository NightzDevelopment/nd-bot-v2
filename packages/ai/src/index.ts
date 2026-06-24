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

// Implemented in the build phase:
// export function getRouter(): { generate(opts): Promise<GenerateResult> }
// export function runAgent(opts: AgentOptions): Promise<GenerateResult>
// export async function retrieve(query: string, k?: number): Promise<KnowledgeDoc[]>
// export async function remember(userId, role, content): Promise<void>

export const AI_SCAFFOLD = true
