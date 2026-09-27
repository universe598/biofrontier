export interface Article {
  id: string
  source: string
  title: string
  authors: string
  abstract: string
  publishedAt: string
  issueDate?: string
  discoveredAt: string
  url: string
  pdfUrl?: string
  doi?: string
  category?: string
  isPreprint: boolean
  isRead: boolean
  isBookmarked: boolean
  downloadPath?: string
  summary?: string
  classification?: ArticleClassification
  classificationFailure?: string
  classificationFailedAt?: string
}

export interface ArticleClassification {
  primaryCategory: string
  secondaryCategory: string
  relatedTags: string[]
  relevance: 'high' | 'possible' | 'other'
  confidence: number
  basis: string[]
  engine: 'local-4b' | 'local-8b' | 'api'
  modelVersion: string
  classifiedAt: string
  inputHash: string
  taxonomyVersion: string
}

export interface LocalClassifierStatus {
  installed: boolean
  running: boolean
  busy: boolean
  modelName: string
  modelSize?: number
  processed: number
  total: number
  failed: number
  restarts: number
  currentTitle?: string
  lastError?: string
  modelPath?: string
  runtimePath?: string
  configurationIssue?: string
}

export type SyncFrequency = 'manual' | 'startup' | 'daily'
export type AiProvider = 'deepseek' | 'openai' | 'anthropic'
export type ClassificationMode = 'rules' | 'local' | 'api'
export type ResearchEngine = 'local' | 'api'

export interface AiModel {
  id: string
  name: string
}

export interface UserProfile {
  nickname: string
  tagline: string
  avatarDataUrl?: string
}

export interface LegalStatus {
  version: string
  accepted: boolean
  acceptedAt?: string
  terms: string
  privacy: string
}

export type ResearchPhase = 'idle' | 'planning' | 'collecting' | 'screening' | 'analyzing' | 'writing' | 'completed' | 'failed' | 'cancelled'

export interface ResearchSourceRef {
  articleId: string
  title: string
  source: string
  publishedAt: string
  url: string
}

export interface ResearchReport {
  id: string
  query: string
  createdAt: string
  completedAt: string
  days: number
  partial: boolean
  aiGenerated?: true
  generatorModel?: string
  generatorType?: ResearchEngine
  summary: string
  trends: string[]
  disagreements: string[]
  gaps: string[]
  cautions: string[]
  readingOrder: Array<{ articleId: string; reason: string }>
  sources: ResearchSourceRef[]
  coverage: {
    fetched: number
    selected: number
    analyzed: number
    sourceErrors: string[]
  }
}

export interface ResearchStatus {
  phase: ResearchPhase
  running: boolean
  progress: number
  message: string
  startedAt?: string
  deadlineAt?: string
  fetched: number
  selected: number
  analyzed: number
  error?: string
  report?: ResearchReport
}

export interface ContentSource {
  id: string
  name: string
  kind: 'builtin' | 'rss'
  url?: string
  enabled: boolean
  frequency: SyncFrequency
  lastSyncedAt?: string
  lastError?: string
  removable: boolean
}

export interface Settings {
  topics: string[]
  browser: 'default' | 'chrome'
  libraryPath: string
  deepseekModel: string
  aiProvider: AiProvider
  aiModel: string
  configuredProviders: AiProvider[]
  hasApiKey: boolean
  syncDays: number
  classificationMode: ClassificationMode
  localClassifierEnabled: boolean
  localClassifierAuto: boolean
  localClassifierPersistent: boolean
  allowPrivateSources: boolean
}

export interface SyncResult {
  added: number
  updated: number
  total: number
  sourceErrors: string[]
  syncedAt: string
}

export interface MatchItem {
  article: Article
  score: number
  reason: string
  caution: string
}

export interface MatchResult {
  overview: string
  matches: MatchItem[]
}

export interface DownloadResult {
  ok: boolean
  path?: string
  message: string
}

export interface BioFrontierApi {
  articles: {
    list: (filter?: { bookmarked?: boolean; search?: string }) => Promise<Article[]>
    sync: () => Promise<SyncResult>
    bookmark: (id: string, value: boolean) => Promise<Article[]>
    read: (id: string, value: boolean) => Promise<Article[]>
    download: (id: string) => Promise<DownloadResult>
    open: (id: string) => Promise<void>
  }
  sources: {
    list: () => Promise<ContentSource[]>
    addRss: (input: { name: string; url: string; frequency: SyncFrequency }) => Promise<ContentSource[]>
    update: (id: string, changes: { enabled?: boolean; frequency?: SyncFrequency; name?: string }) => Promise<ContentSource[]>
    remove: (id: string) => Promise<ContentSource[]>
    importUrl: (url: string) => Promise<Article>
    syncDue: () => Promise<SyncResult | null>
  }
  classifier: {
    status: () => Promise<LocalClassifierStatus>
    run: () => Promise<{ processed: number; failed: number }>
    stop: () => Promise<LocalClassifierStatus>
    chooseModel: () => Promise<LocalClassifierStatus | null>
    chooseRuntime: () => Promise<LocalClassifierStatus | null>
    clearConfiguration: () => Promise<LocalClassifierStatus>
    test: () => Promise<LocalClassifierStatus>
    openOfficialPage: (target: 'model' | 'runtime') => Promise<void>
    apiStatus: () => Promise<ApiClassifierStatus>
    runApi: () => Promise<{ processed: number; failed: number }>
    stopApi: () => Promise<ApiClassifierStatus>
  }
  research: {
    start: (request: { query: string; days: number; maxMinutes?: number; engine?: ResearchEngine }) => Promise<ResearchStatus>
    status: () => Promise<ResearchStatus>
    cancel: () => Promise<ResearchStatus>
    reports: () => Promise<ResearchReport[]>
    export: (id: string) => Promise<string | null>
  }
  ai: {
    summarize: (id: string) => Promise<string>
    match: (query: string) => Promise<MatchResult>
    models: (provider: AiProvider, apiKey?: string) => Promise<AiModel[]>
    disclosureAccepted: (provider: AiProvider) => Promise<boolean>
    acceptDisclosure: (provider: AiProvider) => Promise<boolean>
    grantOnce: (provider: AiProvider) => Promise<boolean>
    revokeDisclosure: (provider: AiProvider) => Promise<boolean>
  }
  legal: {
    status: () => Promise<LegalStatus>
    accept: () => Promise<LegalStatus>
    quit: () => Promise<void>
  }
  settings: {
    get: () => Promise<Settings>
    save: (settings: Partial<Omit<Settings, 'hasApiKey'>>) => Promise<Settings>
    setApiKey: (provider: AiProvider, key: string) => Promise<boolean>
    chooseLibrary: () => Promise<string | null>
  }
  profile: {
    get: () => Promise<UserProfile>
    save: (profile: Pick<UserProfile, 'nickname' | 'tagline'>) => Promise<UserProfile>
    chooseAvatar: () => Promise<UserProfile | null>
    removeAvatar: () => Promise<UserProfile>
  }
}

export interface ApiClassifierStatus {
  configured: boolean
  busy: boolean
  provider: AiProvider
  model: string
  processed: number
  total: number
  failed: number
  currentTitle?: string
  lastError?: string
}
