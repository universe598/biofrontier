import type { AiModel, AiProvider, Article, MatchResult } from '../shared/types'
import { fetchCheckedHttp } from './net'

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export interface AiCallOptions {
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export async function summarizeArticle(article: Article, provider: AiProvider, apiKey: string, model: string): Promise<string> {
  if (!article.abstract) {
    throw new Error('当前来源没有提供摘要。请先在 Chrome 中查看原文，或下载全文后再处理。')
  }
  const content = await callAi(provider, apiKey, model, [
    {
      role: 'system',
      content: [
        '你是谨慎的生物医学文献初读助手。',
        '只能根据用户提供的标题和摘要回答，不得补充未提供的实验细节。',
        '明确区分作者主张、摘要中可见的证据和你的初步推断。',
        '使用简洁中文，聚焦研究问题、方法、结果和局限。'
      ].join('\n')
    },
    {
      role: 'user',
      content: `请对以下公开文献做初步了解。\n\n标题：${article.title}\n来源：${article.source}\n发布日期：${article.publishedAt}\n作者：${article.authors}\n摘要：${article.abstract}\n\n请严格按以下小标题输出：\n研究问题\n核心发现\n研究方法与对象（摘要未说明则写“摘要未说明”）\n可能的意义\n局限与需要核对之处\n初读结论`
    }
  ])
  return `基于来源摘要的 AI 初步解读\n\n${content}`
}

export async function matchNeed(
  query: string,
  candidates: Article[],
  provider: AiProvider,
  apiKey: string,
  model: string
): Promise<MatchResult> {
  const compact = candidates.slice(0, 50).map((article) => ({
    id: article.id,
    title: article.title,
    source: article.source,
    publishedAt: article.publishedAt,
    abstract: article.abstract.slice(0, 1600)
  }))
  const content = await callAi(
    provider,
    apiKey,
    model,
    [
      {
        role: 'system',
        content: [
          '你是生物学资料初筛助手，只能依据候选记录内容进行匹配。',
          '这是初步判断，不得宣称研究结论已经被证实。',
          '返回严格 JSON，不要 Markdown。',
          '结构：{"overview":"总体说明","matches":[{"id":"候选id","score":0到100的整数,"reason":"匹配原因","caution":"不符合或需要核对之处"}]}。',
          '最多返回 8 项，按 score 降序。id 必须原样复制。'
        ].join('\n')
      },
      {
        role: 'user',
        content: `我的需求：${query}\n\n候选记录：${JSON.stringify(compact)}`
      }
    ],
    true
  )
  let parsed: { overview?: string; matches?: Array<{ id?: string; score?: number; reason?: string; caution?: string }> }
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('AI 返回了无法解析的匹配结果，请稍后重试。')
  }
  const byId = new Map(candidates.map((article) => [article.id, article]))
  return {
    overview: parsed.overview || '以下是基于标题和摘要的初步匹配。',
    matches: (parsed.matches || [])
      .map((match) => {
        const article = match.id ? byId.get(match.id) : undefined
        return article
          ? {
              article,
              score: Math.max(0, Math.min(100, Math.round(match.score || 0))),
              reason: match.reason || '',
              caution: match.caution || ''
            }
          : null
      })
      .filter((item): item is MatchResult['matches'][number] => Boolean(item))
  }
}

export async function listAiModels(provider: AiProvider, apiKey: string): Promise<AiModel[]> {
  if (!apiKey.trim()) throw new Error(`请先填写 ${providerLabel(provider)} API Key。`)
  const endpoint = provider === 'deepseek' ? 'https://api.deepseek.com/models' : provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models?limit=1000'
  const response = await fetchCheckedHttp(endpoint, {
    headers: provider === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(45_000)
  })
  const data = await response.json().catch(() => ({})) as { data?: Array<{ id?: string; display_name?: string }>; error?: { message?: string } }
  if (!response.ok) throw new Error(data.error?.message || `${providerLabel(provider)} 连接失败（HTTP ${response.status}）`)
  const models = (data.data || [])
    .filter((item) => item.id && supportsTextGeneration(provider, item.id))
    .map((item) => ({ id: String(item.id), name: item.display_name || displayModelName(String(item.id)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (!models.length) throw new Error(`${providerLabel(provider)} 没有返回可用的文本模型。`)
  return models
}

export async function callAi(
  provider: AiProvider,
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  json = false,
  options: AiCallOptions = {}
): Promise<string> {
  if (process.env.BIOFRONTIER_AI_FAKE === '1') return fakeAiResponse(messages)
  if (!apiKey) throw new Error(`请先在设置中填写 ${providerLabel(provider)} API Key。`)
  if (provider === 'anthropic') return callAnthropic(apiKey, model, messages, json, options)
  if (provider === 'openai') return callOpenAi(apiKey, model, messages, json, options)
  const response = await fetchCheckedHttp('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: json ? { type: 'json_object' } : undefined,
      max_tokens: options.maxTokens || (json ? 3000 : 2200),
      stream: false
    }),
    signal: combinedSignal(options.signal, options.timeoutMs || 90_000)
  })
  const data = (await response.json().catch(() => ({}))) as DeepSeekResponse
  if (!response.ok) {
    throw new Error(data.error?.message || `DeepSeek 请求失败（HTTP ${response.status}）`)
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('DeepSeek 没有返回可用内容。')
  return content
}

async function callOpenAi(apiKey: string, model: string, messages: Array<{ role: 'system' | 'user'; content: string }>, json: boolean, options: AiCallOptions): Promise<string> {
  const response = await fetchCheckedHttp('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: messages, max_output_tokens: options.maxTokens || (json ? 3000 : 2200), text: json ? { format: { type: 'json_object' } } : undefined, store: false }),
    signal: combinedSignal(options.signal, options.timeoutMs || 90_000)
  })
  const data = await response.json().catch(() => ({})) as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(data.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`)
  const content = (data.output_text || data.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '').trim()
  if (!content) throw new Error('OpenAI 没有返回可用内容。')
  return content
}

async function callAnthropic(apiKey: string, model: string, messages: Array<{ role: 'system' | 'user'; content: string }>, json: boolean, options: AiCallOptions): Promise<string> {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  const userMessages = messages.filter((message) => message.role === 'user')
  const response = await fetchCheckedHttp('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, system, messages: userMessages, max_tokens: options.maxTokens || (json ? 3000 : 2200), temperature: 0 }),
    signal: combinedSignal(options.signal, options.timeoutMs || 90_000)
  })
  const data = await response.json().catch(() => ({})) as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } }
  if (!response.ok) throw new Error(data.error?.message || `Claude 请求失败（HTTP ${response.status}）`)
  const content = (data.content || []).filter((item) => item.type === 'text').map((item) => item.text || '').join('').trim()
  if (!content) throw new Error('Claude 没有返回可用内容。')
  return content
}

function supportsTextGeneration(provider: AiProvider, id: string): boolean {
  if (provider !== 'openai') return true
  const value = id.toLowerCase()
  return !['embedding', 'moderation', 'image', 'dall-e', 'tts', 'transcribe', 'whisper', 'audio', 'realtime', 'search'].some((term) => value.includes(term))
    && /^(gpt|o\d|chatgpt)/.test(value)
}

function providerLabel(provider: AiProvider): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Claude'
  return 'DeepSeek'
}

function displayModelName(id: string): string {
  return id.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(' ')
}

export function parseAiJson(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = JSON.parse(cleaned) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch {
    throw new Error('AI 没有返回有效的结构化结果，请重试或更换模型。')
  }
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(5_000, timeoutMs))
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function fakeAiResponse(messages: Array<{ role: 'system' | 'user'; content: string }>): string {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n')
  const user = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n')
  if (system.includes('检索规划器')) return JSON.stringify({ searchTerms: ['CRISPR', 'genome editing', 'stem cells'], focus: 'API 测试专题的近期研究进展' })
  if (system.includes('摘要审阅器')) return JSON.stringify({ notes: [{ articleId: 'filter:genetics-source-test', finding: '研究使用CRISPR分析干细胞调控。', method: '摘要中的基因编辑实验。', limitation: '仅依据摘要。', relevance: 95 }] })
  if (system.includes('专题速报编辑')) return JSON.stringify({ summary: 'API 模式已根据公开摘要生成专题速报。', trends: ['基因编辑与干细胞研究持续结合。'], disagreements: ['需要全文核对不同实验体系。'], gaps: ['需要更多重复验证。'], cautions: ['仅依据标题和摘要。'], readingOrder: [{ articleId: 'filter:genetics-source-test', reason: '与测试需求直接相关。' }] })
  if (system.includes('批量分类器')) {
    const ids = [...user.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1])
    return JSON.stringify({ classifications: ids.map((articleId) => ({ articleId, categoryId: 'P02-01', relatedCategoryIds: ['P07-01'], relevance: 'high', confidence: 0.9, basis: ['CRISPR', 'genome'] })) })
  }
  return JSON.stringify({ overview: '测试结果', matches: [] })
}
