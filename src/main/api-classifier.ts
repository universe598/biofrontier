import type { AiProvider, ApiClassifierStatus, Article, Settings } from '../shared/types'
import { TAXONOMY_VERSION, taxonomyPrompt } from '../shared/taxonomy'
import type { Store } from './store'
import { callAi, parseAiJson } from './ai'
import { classificationInputHash, classifierSystemPrompt, normalizeClassificationResult } from './classifier'

interface ApiClassifierRunConfig {
  provider: AiProvider
  model: string
  apiKey: string
  settings: Settings
}

export class ApiClassifier {
  private running: Promise<{ processed: number; failed: number }> | null = null
  private controller: AbortController | null = null
  private state = {
    busy: false,
    provider: 'deepseek' as AiProvider,
    model: '',
    processed: 0,
    total: 0,
    failed: 0,
    currentTitle: undefined as string | undefined,
    lastError: ''
  }

  constructor(private store: Store) {}

  status(provider: AiProvider, model: string, configured: boolean): ApiClassifierStatus {
    const modelVersion = apiModelVersion(provider, model)
    const settings = this.store.getSettings()
    return {
      configured,
      busy: this.state.busy,
      provider: this.state.busy ? this.state.provider : provider,
      model: this.state.busy ? this.state.model : model,
      processed: this.state.busy ? this.state.processed : 0,
      total: this.state.busy ? this.state.total : this.pendingArticles(modelVersion, settings.topics).length,
      failed: this.state.failed,
      currentTitle: this.state.currentTitle,
      lastError: this.state.lastError || undefined
    }
  }

  run(config: ApiClassifierRunConfig): Promise<{ processed: number; failed: number }> {
    if (this.running) return this.running
    this.running = this.runInternal(config).finally(() => { this.running = null })
    return this.running
  }

  stop(provider: AiProvider, model: string, configured: boolean): ApiClassifierStatus {
    this.controller?.abort(new Error('API 分类已暂停。'))
    this.controller = null
    this.state.busy = false
    this.state.currentTitle = undefined
    return this.status(provider, model, configured)
  }

  private async runInternal(config: ApiClassifierRunConfig): Promise<{ processed: number; failed: number }> {
    const modelVersion = apiModelVersion(config.provider, config.model)
    const pending = this.pendingArticles(modelVersion, config.settings.topics)
    this.controller = new AbortController()
    this.state = { busy: true, provider: config.provider, model: config.model, processed: 0, total: pending.length, failed: 0, currentTitle: undefined, lastError: '' }
    let consecutiveBatchFailures = 0
    try {
      for (let offset = 0; offset < pending.length; offset += 8) {
        if (this.controller.signal.aborted) break
        const batch = pending.slice(offset, offset + 8)
        this.state.currentTitle = batch[0]?.title
        try {
          const content = await callAi(config.provider, config.apiKey, config.model, [
            { role: 'system', content: `${classifierSystemPrompt().replace('/no_think', '')}\n你现在是批量分类器。必须为每个输入 articleId 返回且只返回一项，使用 classifications 数组包裹结果。` },
            { role: 'user', content: apiClassifierInput(batch, config.settings.topics) }
          ], true, { maxTokens: 2400, timeoutMs: 150_000, signal: this.controller.signal })
          const parsed = parseAiJson(content)
          const records = Array.isArray(parsed.classifications) ? parsed.classifications : []
          const byId = new Map(records
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
            .map((item) => [String(item.articleId || ''), item]))
          for (const article of batch) {
            const record = byId.get(article.id)
            try {
              if (!record) throw new Error('API 未返回这篇文章的分类。')
              this.store.setClassification(article.id, normalizeClassificationResult(article, record, modelVersion, config.settings.topics, 'api'))
              this.state.processed += 1
            } catch (error) {
              this.recordFailure(article, error)
            }
          }
          consecutiveBatchFailures = 0
        } catch (error) {
          if (this.controller.signal.aborted) break
          this.state.lastError = error instanceof Error ? error.message : String(error)
          for (const article of batch) this.recordFailure(article, error)
          consecutiveBatchFailures += 1
          if (consecutiveBatchFailures >= 2) break
        }
      }
      return { processed: this.state.processed, failed: this.state.failed }
    } finally {
      this.controller = null
      this.state.busy = false
      this.state.currentTitle = undefined
    }
  }

  private recordFailure(article: Article, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.state.failed += 1
    this.state.lastError = message
    this.store.setClassificationFailure(article.id, `API 分类失败：${message}`)
  }

  private pendingArticles(modelVersion: string, topics: string[]): Article[] {
    return this.store.listArticles()
      .filter((article) => article.abstract.trim())
      .filter((article) => !article.classification
        || article.classification.taxonomyVersion !== TAXONOMY_VERSION
        || article.classification.modelVersion !== modelVersion
        || article.classification.inputHash !== classificationInputHash(article, topics))
  }
}

function apiClassifierInput(articles: Article[], topics: string[]): string {
  const allowPending = articles.some((article) => article.abstract.trim().length < 80)
  const records = articles.map((article) => ({
    id: article.id,
    source: article.source,
    sourceCategory: article.category || '',
    title: article.title,
    abstract: article.abstract.slice(0, 4_000),
    allowPending: article.abstract.trim().length < 80
  }))
  return `分类体系：\n${taxonomyPrompt(allowPending)}\n\n用户关注方向：${topics.join('；') || '未设置'}\n\n待分类记录：${JSON.stringify(records)}\n\n返回严格 JSON：{"classifications":[{"articleId":"原样复制id","categoryId":"分类路径编号","relatedCategoryIds":[],"relevance":"high|possible|other","confidence":0到1,"basis":["摘要依据"]}]}。每篇恰好一项；只有 allowPending=true 的记录可以使用待确认路径。`
}

function apiModelVersion(provider: AiProvider, model: string): string {
  return `api:${provider}:${model}`
}
