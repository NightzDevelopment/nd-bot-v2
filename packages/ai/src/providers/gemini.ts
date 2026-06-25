/**
 * Gemini provider: wraps @google/generative-ai for plain generation and for
 * the agent's function-calling loop. Reads key + model from @nd/core env.
 */
import { loadEnv } from '@nd/core'
import {
  type Content,
  type FunctionDeclaration,
  GoogleGenerativeAI,
  type Part,
} from '@google/generative-ai'
import type { AIProvider, GenerateOptions, GenerateResult } from '../index.ts'

let client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (client) return client
  const { GEMINI_API_KEY } = loadEnv()
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured')
  }
  client = new GoogleGenerativeAI(GEMINI_API_KEY)
  return client
}

function geminiModel(): string {
  return loadEnv().GEMINI_MODEL
}

/** Map our neutral history into Gemini Content turns. */
export function toGeminiHistory(history: GenerateOptions['history']): Content[] {
  return (history ?? []).map((turn) => ({
    role: turn.role === 'model' ? 'model' : 'user',
    parts: [{ text: turn.content }] as Part[],
  }))
}

export interface GeminiCallResult {
  text: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

/** Single-shot generation with no tools. */
export async function geminiGenerateText(opts: GenerateOptions): Promise<GeminiCallResult> {
  const model = geminiModel()
  const gen = getClient().getGenerativeModel({
    model,
    ...(opts.system ? { systemInstruction: opts.system } : {}),
  })

  const contents: Content[] = [
    ...toGeminiHistory(opts.history),
    { role: 'user', parts: [{ text: opts.prompt }] },
  ]

  const result = await gen.generateContent({
    contents,
    ...(opts.maxTokens ? { generationConfig: { maxOutputTokens: opts.maxTokens } } : {}),
  })

  const usage = result.response.usageMetadata
  return {
    text: result.response.text(),
    model,
    ...(usage ? { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount } : {}),
  }
}

export const geminiProvider: AIProvider = {
  name: 'gemini',
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const r = await geminiGenerateText(opts)
    return { text: r.text, provider: 'gemini', model: r.model, cached: false }
  },
}

// ---- Low-level access used by the agent loop ------------------------------

export interface GeminiToolDecl {
  declarations: FunctionDeclaration[]
}

/**
 * Run a single generateContent turn with optional tool declarations and an
 * explicit content history. Returns the raw response so the agent loop can
 * inspect function calls and assemble follow-up turns.
 */
export async function geminiGenerateContent(params: {
  system?: string | undefined
  contents: Content[]
  tools?: FunctionDeclaration[] | undefined
  maxTokens?: number | undefined
}) {
  const model = geminiModel()
  const gen = getClient().getGenerativeModel({
    model,
    ...(params.system ? { systemInstruction: params.system } : {}),
    ...(params.tools && params.tools.length > 0
      ? { tools: [{ functionDeclarations: params.tools }] }
      : {}),
  })

  const result = await gen.generateContent({
    contents: params.contents,
    ...(params.maxTokens ? { generationConfig: { maxOutputTokens: params.maxTokens } } : {}),
  })

  return { model, response: result.response }
}
