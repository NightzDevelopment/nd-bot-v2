/**
 * Agentic tool-calling loop on top of Gemini function-calling.
 *
 * Each iteration sends the running content history (plus tool declarations) to
 * Gemini. If the model emits function calls, every AgentTool.execute is run and
 * the results are fed back as functionResponse parts for the next turn. The loop
 * ends when the model returns text with no further calls, or maxIterations is
 * hit. Telemetry is recorded per model turn.
 */
import { createLogger } from '@nd/core'
import type { Content, FunctionDeclaration, Part } from '@google/generative-ai'
import { SchemaType } from '@google/generative-ai'
import { geminiGenerateContent, toGeminiHistory } from './providers/gemini.ts'
import { recordTelemetry } from './telemetry.ts'
import type { AgentOptions, AgentTool, GenerateResult } from './index.ts'

const log = createLogger('ai:agent')

const DEFAULT_MAX_ITERATIONS = 6

/**
 * Build a Gemini FunctionDeclaration from an AgentTool. The tool's `parameters`
 * is treated as a JSON-schema object; when absent we declare a parameterless
 * function with an empty OBJECT schema.
 */
function toFunctionDeclaration(tool: AgentTool): FunctionDeclaration {
  const params = tool.parameters as
    | { properties?: Record<string, unknown>; required?: string[] }
    | undefined
  const hasProps = params && params.properties && Object.keys(params.properties).length > 0
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: (hasProps ? params.properties : {}) as Record<string, never>,
      ...(params?.required ? { required: params.required } : {}),
    },
  }
}

/** Result of an agent run: the final text plus how many model turns it took. */
export interface AgentResult extends GenerateResult {
  iterations: number
}

/**
 * Run the agent loop. Returns the final assistant text. Tools are optional; with
 * none supplied this degrades to a single Gemini generation.
 */
export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const tools = opts.tools ?? []
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const toolMap = new Map<string, AgentTool>(tools.map((t) => [t.name, t]))
  const declarations = tools.map(toFunctionDeclaration)

  const contents: Content[] = [
    ...toGeminiHistory(opts.history),
    { role: 'user', parts: [{ text: opts.prompt }] },
  ]

  let finalText = ''
  let model = ''
  let iterations = 0

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1
    const start = Date.now()
    let response: Awaited<ReturnType<typeof geminiGenerateContent>>['response']
    try {
      const turn = await geminiGenerateContent({
        system: opts.system,
        contents,
        tools: declarations.length > 0 ? declarations : undefined,
        maxTokens: opts.maxTokens,
      })
      model = turn.model
      response = turn.response
    } catch (err) {
      await recordTelemetry({
        provider: 'gemini',
        model,
        intent: opts.intent,
        latencyMs: Date.now() - start,
        cached: false,
        ok: false,
      })
      throw err
    }

    const usage = response.usageMetadata
    await recordTelemetry({
      provider: 'gemini',
      model,
      intent: opts.intent ?? 'agent',
      latencyMs: Date.now() - start,
      cached: false,
      ok: true,
      ...(usage ? { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount } : {}),
    })

    const calls = response.functionCalls()

    if (!calls || calls.length === 0) {
      finalText = response.text()
      break
    }

    // Record the model's function-call turn so the responses line up with it.
    contents.push({
      role: 'model',
      parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }) as Part),
    })

    const responseParts: Part[] = []
    for (const call of calls) {
      const tool = toolMap.get(call.name)
      let output: unknown
      if (!tool) {
        output = { error: `unknown tool: ${call.name}` }
      } else {
        try {
          output = await tool.execute(call.args)
        } catch (err) {
          log.warn({ err, tool: call.name }, 'agent tool execution failed')
          output = { error: err instanceof Error ? err.message : String(err) }
        }
      }
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: wrapResponse(output),
        },
      } as Part)
    }

    contents.push({ role: 'user', parts: responseParts })
  }

  return {
    text: finalText,
    provider: 'gemini',
    model,
    cached: false,
    iterations,
  }
}

/** Gemini requires functionResponse.response to be a JSON object. */
function wrapResponse(output: unknown): object {
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    return output as object
  }
  return { result: output }
}
