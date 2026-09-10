import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, screen } from 'electron'
import path from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { Store } from './store'
import { fetchSource, importWebPage } from './sources'
import { downloadArticle, openArticle } from './files'
import { callAi, listAiModels, matchNeed, parseAiJson, summarizeArticle } from './ai'
import { LocalClassifier } from './classifier'
import { LocalResearch } from './research'
import { mapSettledWithLimit } from './async'
import { ApiClassifier } from './api-classifier'
import type { AiProvider, ContentSource, ResearchEngine, Settings, SyncFrequency, SyncResult, UserProfile } from '../shared/types'

let store: Store
let classifier: LocalClassifier
let apiClassifier: ApiClassifier
let research: LocalResearch
const LEGAL_VERSION = '2026-09-04-v2'
const oneTimeAiDisclosures = new Set<AiProvider>()

// The interface is text-first; disabling hardware acceleration avoids driver-specific
// rendering failures on some Windows laptops and does not affect the app's AI work.
app.disableHardwareAcceleration()

function createWindow(): void {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.max(640, Math.min(1280, workArea.width - 32))
  const height = Math.max(560, Math.min(820, workArea.height - 32))
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(760, width),
    minHeight: Math.min(640, height),
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f7f3',
    title: 'BioFrontier 生物前沿',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true
    }
  })
  window.once('ready-to-show', () => {
    // Electron already follows Windows DPI scaling. A second width-based zoom made
    // high-DPI and ultrawide displays oversized and could reintroduce horizontal scroll.
    window.webContents.setZoomFactor(1)
    window.show()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openArticle(url, store.getSettings(configuredProviders()).browser)
    return { action: 'deny' }
  })
  void window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  let defaultLibrary = process.env.BIOFRONTIER_LIBRARY_PATH || path.join(app.getPath('documents'), 'BioFrontier Library')
  try {
    await mkdir(defaultLibrary, { recursive: true })
  } catch {
    defaultLibrary = path.join(app.getPath('userData'), 'Library')
    await mkdir(defaultLibrary, { recursive: true })
  }
  store = new Store(path.join(app.getPath('userData'), 'biofrontier.sqlite'), defaultLibrary)
  classifier = new LocalClassifier(store, process.resourcesPath)
  apiClassifier = new ApiClassifier(store)
  research = new LocalResearch(store, classifier, () => {
    const settings = store.getSettings()
    if (settings.classificationMode === 'local' && settings.localClassifierAuto) void classifier.run().catch(() => undefined)
  })
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { void research?.cancel(); void classifier?.stop(); apiClassifier?.stop('deepseek', '', false) })

function registerIpc(): void {
  ipcMain.handle('legal:status', () => legalStatus())
  ipcMain.handle('legal:accept', async () => {
    store.setSetting('legalAcceptedVersion', LEGAL_VERSION)
    store.setSetting('legalAcceptedAt', new Date().toISOString())
    return legalStatus()
  })
  ipcMain.handle('legal:quit', () => app.quit())
  ipcMain.handle('articles:list', (_event, filter) => store.listArticles(filter || {}))
  ipcMain.handle('articles:sync', async () => {
    return runSourceSync(store.listSources().filter((source) => source.enabled))
  })
  ipcMain.handle('articles:bookmark', (_event, id: string, value: boolean) => {
    store.setBookmark(id, value)
    return store.listArticles()
  })
  ipcMain.handle('articles:read', (_event, id: string, value: boolean) => {
    store.setRead(id, value)
    return store.listArticles()
  })
  ipcMain.handle('articles:open', async (_event, id: string) => {
    const article = requiredArticle(id)
    await openArticle(article.url, store.getSettings(configuredProviders()).browser)
  })
  ipcMain.handle('articles:download', async (_event, id: string) => {
    const article = requiredArticle(id)
    const settings = store.getSettings(configuredProviders())
    const result = await downloadArticle(article, settings.libraryPath, settings.allowPrivateSources)
    if (result.ok && result.path) store.setDownloadPath(id, result.path)
    return result
  })
  ipcMain.handle('ai:summarize', async (_event, id: string) => {
    const article = requiredArticle(id)
    const settings = store.getSettings(configuredProviders())
    requireAiDisclosure(settings.aiProvider)
    const summary = await summarizeArticle(article, settings.aiProvider, getApiKey(settings.aiProvider), settings.aiModel)
    store.setSummary(id, summary)
    return summary
  })
  ipcMain.handle('ai:match', async (_event, query: string) => {
    if (!query?.trim()) throw new Error('请输入需要匹配的研究需求。')
    const candidates = store.listArticles().filter((item) => item.abstract).slice(0, 80)
    if (!candidates.length) throw new Error('当前没有可匹配的摘要，请先同步最新内容。')
    const settings = store.getSettings(configuredProviders())
    requireAiDisclosure(settings.aiProvider)
    return matchNeed(query.trim(), candidates, settings.aiProvider, getApiKey(settings.aiProvider), settings.aiModel)
  })
  ipcMain.handle('ai:models', (_event, provider: AiProvider, apiKey?: string) => listAiModels(provider, apiKey?.trim() || getApiKey(provider)))
  ipcMain.handle('ai:disclosureAccepted', (_event, provider: AiProvider) => {
    validateProvider(provider)
    return store.getSetting(aiDisclosureSetting(provider)) === '1'
  })
  ipcMain.handle('ai:acceptDisclosure', (_event, provider: AiProvider) => {
    validateProvider(provider)
    store.setSetting(aiDisclosureSetting(provider), '1')
    return true
  })
  ipcMain.handle('ai:grantOnce', (_event, provider: AiProvider) => {
    validateProvider(provider)
    oneTimeAiDisclosures.add(provider)
    return true
  })
  ipcMain.handle('ai:revokeDisclosure', (_event, provider: AiProvider) => {
    validateProvider(provider)
    store.setSetting(aiDisclosureSetting(provider), '')
    return true
  })
  ipcMain.handle('settings:get', () => store.getSettings(configuredProviders()))
  ipcMain.handle('settings:save', (_event, settings: Partial<Omit<Settings, 'hasApiKey'>>) => {
    store.saveSettings(settings)
    return store.getSettings(configuredProviders())
  })
  ipcMain.handle('settings:setApiKey', (_event, provider: AiProvider, apiKey: string) => {
    validateProvider(provider)
    if (!apiKey.trim()) {
      store.setSetting(apiKeySetting(provider), '')
      if (provider === 'deepseek') store.setSetting('deepseekApiKey', '')
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，未保存 API Key。')
    const encrypted = safeStorage.encryptString(apiKey.trim()).toString('base64')
    store.setSetting(apiKeySetting(provider), encrypted)
    if (provider === 'deepseek') store.setSetting('deepseekApiKey', encrypted)
    return true
  })
  ipcMain.handle('settings:chooseLibrary', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 BioFrontier 资料库文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('classifier:status', () => classifier.status())
  ipcMain.handle('classifier:run', () => classifier.run())
  ipcMain.handle('classifier:stop', () => classifier.stop())
  ipcMain.handle('classifier:chooseModel', async () => {
    const result = await dialog.showOpenDialog({ title: '选择本地 GGUF 模型', properties: ['openFile'], filters: [{ name: 'GGUF 模型', extensions: ['gguf'] }] })
    return result.canceled ? null : classifier.setModelPath(result.filePaths[0])
  })
  ipcMain.handle('classifier:chooseRuntime', async () => {
    const result = await dialog.showOpenDialog({ title: '选择 llama-server.exe', properties: ['openFile'], filters: [{ name: 'llama.cpp 服务程序', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] })
    return result.canceled ? null : classifier.setRuntimePath(result.filePaths[0])
  })
  ipcMain.handle('classifier:clearConfiguration', () => classifier.clearConfiguration())
  ipcMain.handle('classifier:test', () => classifier.testConfiguration())
  ipcMain.handle('classifier:apiStatus', () => {
    const settings = store.getSettings(configuredProviders())
    return apiClassifier.status(settings.aiProvider, settings.aiModel, settings.hasApiKey)
  })
  ipcMain.handle('classifier:runApi', () => {
    const settings = store.getSettings(configuredProviders())
    requireAiDisclosure(settings.aiProvider)
    return apiClassifier.run({ provider: settings.aiProvider, model: settings.aiModel, apiKey: getApiKey(settings.aiProvider), settings })
  })
  ipcMain.handle('classifier:stopApi', () => {
    const settings = store.getSettings(configuredProviders())
    return apiClassifier.stop(settings.aiProvider, settings.aiModel, settings.hasApiKey)
  })
  ipcMain.handle('classifier:openOfficialPage', async (_event, target: 'model' | 'runtime') => {
    const url = target === 'model'
      ? 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/tree/main'
      : 'https://github.com/ggml-org/llama.cpp/releases/latest'
    await openArticle(url, store.getSettings(configuredProviders()).browser)
  })
  ipcMain.handle('research:start', (_event, request: { query: string; days: number; maxMinutes?: number; engine?: ResearchEngine }) => {
    if (request.engine !== 'api') return research.start({ ...request, engine: 'local' })
    const settings = store.getSettings(configuredProviders())
    requireAiDisclosure(settings.aiProvider)
    const apiKey = getApiKey(settings.aiProvider)
    const provider = settings.aiProvider
    const model = settings.aiModel
    return research.start({ ...request, engine: 'api' }, {
      label: `${providerLabel(provider)} API · ${model}`,
      complete: async (generation, signal) => {
        const content = await callAi(provider, apiKey, model, generation.messages, true, { maxTokens: generation.maxTokens, timeoutMs: generation.timeoutMs, signal })
        return JSON.stringify(parseAiJson(content))
      }
    })
  })
  ipcMain.handle('research:status', () => research.status())
  ipcMain.handle('research:cancel', () => research.cancel())
  ipcMain.handle('research:reports', () => research.reports())
  ipcMain.handle('research:export', async (_event, id: string) => {
    const report = research.reports().find((item) => item.id === id)
    if (!report) throw new Error('没有找到这份专题速报。')
    const reportDirectory = path.join(store.getSettings().libraryPath, 'Reports')
    await mkdir(reportDirectory, { recursive: true })
    const defaultName = `${report.completedAt.slice(0, 10)}-${safeFileName(report.query).slice(0, 48) || '专题速报'}.md`
    const result = await dialog.showSaveDialog({ title: '导出专题速报', defaultPath: path.join(reportDirectory, defaultName), filters: [{ name: 'Markdown 文档', extensions: ['md'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, researchReportMarkdown(report), 'utf8')
    return result.filePath
  })
  ipcMain.handle('profile:get', () => getProfile())
  ipcMain.handle('profile:save', (_event, profile: Pick<UserProfile, 'nickname' | 'tagline'>) => {
    store.setSetting('profileNickname', cleanProfileText(profile.nickname, 32) || '研究者')
    store.setSetting('profileTagline', cleanProfileText(profile.tagline, 48) || '我的生物前沿')
    return getProfile()
  })
  ipcMain.handle('profile:chooseAvatar', async () => {
    const result = await dialog.showOpenDialog({ title: '选择本地头像', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (result.canceled) return null
    const image = nativeImage.createFromPath(result.filePaths[0])
    if (image.isEmpty()) throw new Error('无法读取这张图片，请选择 PNG、JPG 或 WebP。')
    const size = image.getSize()
    const side = Math.min(size.width, size.height)
    const cropped = image.crop({ x: Math.floor((size.width - side) / 2), y: Math.floor((size.height - side) / 2), width: side, height: side }).resize({ width: 256, height: 256, quality: 'best' })
    await writeFile(profileAvatarPath(), cropped.toPNG())
    return getProfile()
  })
  ipcMain.handle('profile:removeAvatar', async () => {
    await unlink(profileAvatarPath()).catch(() => undefined)
    return getProfile()
  })
  ipcMain.handle('sources:list', () => store.listSources())
  ipcMain.handle('sources:addRss', async (_event, input: { name: string; url: string; frequency: SyncFrequency }) => {
    if (!input.name?.trim()) throw new Error('请填写来源名称。')
    const before = new Set(store.listSources().map((source) => source.id))
    store.addRssSource({ name: input.name.trim(), url: input.url.trim(), frequency: input.frequency })
    const created = store.listSources().find((source) => !before.has(source.id))
    if (!created) throw new Error('来源创建失败。')
    await runSourceSync([created])
    return store.listSources()
  })
  ipcMain.handle('sources:update', (_event, id: string, changes: { enabled?: boolean; frequency?: SyncFrequency; name?: string }) => {
    return store.updateSource(id, changes)
  })
  ipcMain.handle('sources:remove', (_event, id: string) => store.removeSource(id))
  ipcMain.handle('sources:importUrl', async (_event, url: string) => {
    const item = await importWebPage(url, store.getSettings().allowPrivateSources)
    store.upsertArticles([item])
    store.setBookmark(item.id, true)
    return requiredArticle(item.id)
  })
  ipcMain.handle('sources:syncDue', async () => {
    const now = Date.now()
    const due = store.listSources().filter((source) => {
      if (!source.enabled || source.frequency === 'manual') return false
      if (source.frequency === 'startup') return true
      const last = source.lastSyncedAt ? new Date(source.lastSyncedAt).getTime() : 0
      return !last || now - last >= 24 * 60 * 60 * 1000
    })
    return due.length ? runSourceSync(due) : null
  })
}

async function runSourceSync(sources: ContentSource[]): Promise<SyncResult> {
  const settings = store.getSettings(configuredProviders())
  const now = Date.now()
  const fetched = await mapSettledWithLimit(sources, 3, async (source) => {
    const last = source.lastSyncedAt ? new Date(source.lastSyncedAt).getTime() : 0
    const missedDays = last ? Math.ceil((now - last) / (24 * 60 * 60 * 1000)) + 1 : settings.syncDays
    return fetchSource(source, { ...settings, syncDays: Math.min(14, Math.max(settings.syncDays, missedDays)) })
  })
  let added = 0
  let updated = 0
  const errors: string[] = []
  const syncedAt = new Date().toISOString()
  fetched.forEach((result, index) => {
    const source = sources[index]
    if (result.status === 'fulfilled') {
      const changes = store.upsertArticles(result.value)
      added += changes.added
      updated += changes.updated
      store.updateSourceStatus(source.id, syncedAt, null)
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push(`${source.name}：${message}`)
      store.updateSourceStatus(source.id, null, message)
    }
  })
  store.setSetting('lastSync', syncedAt)
  return { added, updated, total: store.listArticles().length, sourceErrors: errors, syncedAt }
}

function requiredArticle(id: string) {
  const article = store.getArticle(id)
  if (!article) throw new Error('没有找到这条记录。')
  return article
}

function configuredProviders(): AiProvider[] {
  return (['deepseek', 'openai', 'anthropic'] as AiProvider[]).filter((provider) => Boolean(store?.getSetting(apiKeySetting(provider)) || (provider === 'deepseek' && store?.getSetting('deepseekApiKey'))))
}

function getApiKey(provider: AiProvider): string {
  validateProvider(provider)
  if (process.env.BIOFRONTIER_AI_FAKE === '1') return 'fake-api-key'
  const encrypted = store.getSetting(apiKeySetting(provider)) || (provider === 'deepseek' ? store.getSetting('deepseekApiKey') : undefined)
  if (!encrypted) throw new Error(`请先在设置中填写 ${provider === 'anthropic' ? 'Claude' : provider === 'openai' ? 'OpenAI' : 'DeepSeek'} API Key。`)
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用。')
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    throw new Error('无法读取已保存的 API Key，请在设置中重新填写。')
  }
}

function providerLabel(provider: AiProvider): string {
  return provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Claude' : 'DeepSeek'
}

function apiKeySetting(provider: AiProvider): string {
  return `aiApiKey:${provider}`
}

function aiDisclosureSetting(provider: AiProvider): string {
  return `aiDisclosureAccepted:${provider}`
}

function requireAiDisclosure(provider: AiProvider): void {
  if (store.getSetting(aiDisclosureSetting(provider)) !== '1' && !oneTimeAiDisclosures.delete(provider)) {
    throw new Error(`发送给 ${provider === 'anthropic' ? 'Claude' : provider === 'openai' ? 'OpenAI' : 'DeepSeek'} 前需要确认数据发送提示。`)
  }
}

async function legalStatus(): Promise<import('../shared/types').LegalStatus> {
  const applicationPath = app.getAppPath()
  const [terms, privacy] = await Promise.all([
    readFile(path.join(applicationPath, 'TERMS.md'), 'utf8'),
    readFile(path.join(applicationPath, 'PRIVACY.md'), 'utf8')
  ])
  const acceptedAt = store.getSetting('legalAcceptedAt') || undefined
  return {
    version: LEGAL_VERSION,
    accepted: store.getSetting('legalAcceptedVersion') === LEGAL_VERSION,
    acceptedAt,
    terms,
    privacy
  }
}

function validateProvider(provider: AiProvider): void {
  if (!['deepseek', 'openai', 'anthropic'].includes(provider)) throw new Error('不支持这个 AI 服务商。')
}

function profileAvatarPath(): string {
  return path.join(app.getPath('userData'), 'profile-avatar.png')
}

async function getProfile(): Promise<UserProfile> {
  const image = nativeImage.createFromPath(profileAvatarPath())
  return {
    nickname: store.getSetting('profileNickname') || '研究者',
    tagline: store.getSetting('profileTagline') || '我的生物前沿',
    avatarDataUrl: image.isEmpty() ? undefined : image.toDataURL()
  }
}

function cleanProfileText(value: string, limit: number): string {
  return String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function researchReportMarkdown(report: import('../shared/types').ResearchReport): string {
  const list = (title: string, values: string[]) => `## ${title}\n\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- 现有摘要没有提供足够信息。'}`
  const byId = new Map(report.sources.map((source) => [source.articleId, source]))
  const reading = report.readingOrder.map((item, index) => {
    const source = byId.get(item.articleId)
    return source ? `${index + 1}. [${source.title}](${source.url}) — ${item.reason}` : ''
  }).filter(Boolean).join('\n') || '暂无。'
  const sources = report.sources.map((source) => `- [${source.title}](${source.url}) — ${source.source}，${source.publishedAt}`).join('\n')
  const metadata = JSON.stringify({ aiGenerated: true, generator: 'BioFrontier', model: report.generatorModel || 'local-model', generatedAt: report.completedAt, reportId: report.id })
  return `<!-- biofrontier-ai-generated ${metadata} -->\n# ${report.query}\n\n> **AI 辅助生成** · ${report.generatorModel || '本地模型'} · ${report.completedAt} · 最近 ${report.days} 天${report.partial ? ' · 限时部分报告' : ''}\n>\n> 仅依据公开标题和摘要生成，请核对原始来源。\n\n## 速报摘要\n\n${report.summary}\n\n${list('主要趋势', report.trends)}\n\n${list('分歧与不确定性', report.disagreements)}\n\n${list('研究空白', report.gaps)}\n\n${list('阅读时需要注意', report.cautions)}\n\n## 建议优先阅读\n\n${reading}\n\n## 原始来源\n\n${sources}\n\n---\n\nAI 辅助生成。搜集 ${report.coverage.fetched} 条，筛选 ${report.coverage.selected} 条，分析 ${report.coverage.analyzed} 条。报告仅依据公开标题和摘要；内容版权及再使用条件以原始来源为准。\n`
}
