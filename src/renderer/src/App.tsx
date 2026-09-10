import { useDeferredValue, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AiModel, AiProvider, ApiClassifierStatus, Article, ClassificationMode, ContentSource, LegalStatus, LocalClassifierStatus, MatchResult, ResearchEngine, ResearchReport, ResearchStatus, Settings, SyncFrequency, UserProfile } from '../../shared/types'
import { PRIMARY_CATEGORIES, TAXONOMY_VERSION, secondaryCategories, validPrimary, validSecondary } from '../../shared/taxonomy'

type Tab = 'latest' | 'favorites' | 'match' | 'research' | 'sources' | 'settings'
type StatusFilter = 'all' | 'unread' | 'read' | 'bookmarked'
type ClassificationStatusFilter = 'all' | 'classified' | 'unclassified' | 'insufficient' | 'uncertain' | 'failed'
type RelevanceFilter = 'all' | 'high' | 'possible' | 'other'
type TypeFilter = 'all' | 'journal' | 'preprint'
type TimeFilter = 'all' | '1' | '3' | '7' | '14' | '30'
type Relevance = Exclude<RelevanceFilter, 'all'>

interface ArticleInsight {
  primaryCategory: string
  secondaryCategory: string
  relatedTags: string[]
  relevance: Relevance
  isAi: boolean
  aiLabel?: string
}

interface Filters {
  status: StatusFilter
  classificationStatus: ClassificationStatusFilter
  relevance: RelevanceFilter
  type: TypeFilter
  time: TimeFilter
  source: string
  primary: string[]
  secondary: string[]
}

const EMPTY_FILTERS: Filters = {
  status: 'all',
  classificationStatus: 'all',
  relevance: 'all',
  type: 'all',
  time: 'all',
  source: 'all',
  primary: [],
  secondary: []
}

interface FilterChip {
  kind: keyof Filters
  value: string
  label: string
}

const CLASSIFICATION_STATUS_OPTIONS = [
  { value: 'classified', label: 'AI 分类完成' },
  { value: 'unclassified', label: '尚未 AI 分类' },
  { value: 'insufficient', label: '摘要信息不足' },
  { value: 'uncertain', label: '模型待确认' },
  { value: 'failed', label: '分类失败' }
] as const

const FALLBACK_RULES = [
  { primary: '遗传、组学与进化', secondary: '基因组学', keywords: ['gene', 'genetic', 'genomic', 'genome', 'mutation', 'dna', 'chromatin', '遗传', '基因', '基因组'] },
  { primary: '生物技术、计算与研究方法', secondary: '基因编辑', keywords: ['crispr', 'base editing', 'prime editing', 'gene editing', '基因编辑'] },
  { primary: '遗传、组学与进化', secondary: '表观遗传', keywords: ['epigen*', 'methylation', '表观遗传', '甲基化'] },
  { primary: '免疫、微生物与感染', secondary: '炎症与自身免疫', keywords: ['immune', 'immun*', 'inflammation', 'cytokine', 'autoimmune', '免疫', '炎症'] },
  { primary: '免疫、微生物与感染', secondary: '病毒学', keywords: ['virus', 'viral', 'virology', '病毒'] },
  { primary: '免疫、微生物与感染', secondary: '细菌学', keywords: ['bacter*', 'pathogen', 'infection', 'antibiotic', '细菌', '感染'] },
  { primary: '神经、认知与行为', secondary: '神经环路与突触', keywords: ['neuron', 'neural', 'brain', 'synap*', 'microglia', '神经', '大脑', '突触'] },
  { primary: '神经、认知与行为', secondary: '神经退行性疾病', keywords: ['alzheimer', 'parkinson', 'neurodegener*', '神经退行'] },
  { primary: '疾病机制与临床转化', secondary: '肿瘤', keywords: ['cancer', 'tumor', 'tumour', 'carcinoma', 'leukemia', 'lymphoma', 'metastasis', 'oncogen*', '肿瘤', '癌'] },
  { primary: '疾病机制与临床转化', secondary: '代谢与内分泌', keywords: ['diabetes', 'obesity', 'endocrine', 'metabolic disease', '糖尿病', '肥胖', '内分泌'] },
  { primary: '公共卫生与人群研究', secondary: '营养与健康', keywords: ['nutrition', 'diet', 'dietary', 'food intake', '营养', '膳食', '饮食'] },
  { primary: '公共卫生与人群研究', secondary: '健康经济与政策', keywords: ['health economics', 'health policy', 'healthcare cost', '卫生政策', '健康经济'] },
  { primary: '公共卫生与人群研究', secondary: '环境健康', keywords: ['environmental health', 'human welfare', 'air pollution', 'heat exposure', '环境健康', '空气污染'] },
  { primary: '公共卫生与人群研究', secondary: '流行病学', keywords: ['epidemiolog*', 'population study', 'cohort', 'public health', '流行病', '公共卫生', '队列'] },
  { primary: '生态、环境与生物多样性', secondary: '气候与生物响应', keywords: ['climate change', 'warming', 'temperature response', '气候变化', '升温'] },
  { primary: '植物、动物与农业', secondary: '植物科学', keywords: ['plant', 'crop', 'arabidopsis', '植物', '作物'] },
  { primary: '植物、动物与农业', secondary: '畜牧与兽医', keywords: ['livestock', 'goat', 'cattle', 'pig', 'veterinary', '畜牧', '兽医', '山羊'] },
  { primary: '生物技术、计算与研究方法', secondary: '实验与测量技术', keywords: ['method', 'assay', 'sequencing', 'microscopy', 'imaging', 'protocol', '方法', '测序', '成像'] },
  { primary: '分子、细胞与发育', secondary: '干细胞与再生', keywords: ['stem cell', 'regeneration', 'organoid', '干细胞', '再生', '类器官'] },
  { primary: '分子、细胞与发育', secondary: '细胞生物学', keywords: ['cell', 'cellular', 'protein', 'signaling', 'organelle', '细胞', '蛋白', '信号通路'] }
] as const

const EMPTY_SETTINGS: Settings = {
  topics: [],
  browser: 'chrome',
  libraryPath: '',
  deepseekModel: 'deepseek-v4-flash',
  aiProvider: 'deepseek',
  aiModel: 'deepseek-v4-flash',
  configuredProviders: [],
  hasApiKey: false,
  syncDays: 7,
  classificationMode: 'rules',
  localClassifierEnabled: false,
  localClassifierAuto: true,
  localClassifierPersistent: true,
  allowPrivateSources: false
}

const EMPTY_PROFILE: UserProfile = { nickname: '研究者', tagline: '我的生物前沿' }
const AI_PROVIDER_LABELS: Record<AiProvider, string> = { deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Claude' }
const INITIAL_ARTICLE_BATCH = 36
const ARTICLE_BATCH_SIZE = 28

export default function App() {
  const [tab, setTab] = useState<Tab>('latest')
  const [articles, setArticles] = useState<Article[]>([])
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS)
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [profileOpen, setProfileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [legalStatus, setLegalStatus] = useState<LegalStatus | null>(null)
  const [legalWorking, setLegalWorking] = useState(false)
  const [legalReviewOpen, setLegalReviewOpen] = useState(false)
  const [startupError, setStartupError] = useState('')
  const [aiConsentProvider, setAiConsentProvider] = useState<AiProvider | null>(null)
  const [renderLimit, setRenderLimit] = useState(INITIAL_ARTICLE_BATCH)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const aiConsentResolver = useRef<((accepted: boolean) => void) | null>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    void initialize()
  }, [])

  useEffect(() => {
    if (!filterOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [filterOpen])

  useEffect(() => {
    if (!filterOpen && !profileOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [filterOpen, profileOpen])

  async function initialize() {
    try {
      const legal = await window.biofrontier.legal.status()
      setLegalStatus(legal)
      if (!legal.accepted) return
      await initializeWorkspace()
    } catch (error) {
      setStartupError(errorText(error))
    }
  }

  async function initializeWorkspace() {
    try {
      const [nextSettings, nextArticles, nextProfile] = await Promise.all([
        window.biofrontier.settings.get(),
        window.biofrontier.articles.list(),
        window.biofrontier.profile.get()
      ])
      setSettings(nextSettings)
      setArticles(nextArticles)
      setProfile(nextProfile)
      if (nextSettings.classificationMode === 'local' && nextSettings.localClassifierAuto) void runLocalClassification(false)
      if (nextArticles.length === 0) {
        await syncArticles()
      } else {
        void window.biofrontier.sources.syncDue().then(async (result) => {
          if (!result) return
          setArticles(await window.biofrontier.articles.list())
          if (nextSettings.classificationMode === 'local' && nextSettings.localClassifierAuto) void runLocalClassification(false)
          if (result.sourceErrors.length) setNotice({ kind: 'error', text: result.sourceErrors.join('；') })
        }).catch(showError)
      }
    } catch (error) {
      showError(error)
    }
  }

  async function acceptLegalAgreement() {
    setLegalWorking(true)
    setStartupError('')
    try {
      const legal = await window.biofrontier.legal.accept()
      setLegalStatus(legal)
      await initializeWorkspace()
    } catch (error) {
      setStartupError(errorText(error))
    } finally {
      setLegalWorking(false)
    }
  }

  async function syncArticles() {
    setSyncing(true)
    setNotice(null)
    try {
      const result = await window.biofrontier.articles.sync()
      setArticles(await window.biofrontier.articles.list())
      const warnings = result.sourceErrors.length ? `；${result.sourceErrors.join('；')}` : ''
      setNotice({ kind: result.sourceErrors.length ? 'error' : 'info', text: `同步完成：新增 ${result.added} 条，共 ${result.total} 条${warnings}` })
      if (settings.classificationMode === 'local' && settings.localClassifierAuto) void runLocalClassification(false)
    } catch (error) {
      showError(error)
    } finally {
      setSyncing(false)
    }
  }

  async function toggleBookmark(article: Article) {
    try {
      setArticles(await window.biofrontier.articles.bookmark(article.id, !article.isBookmarked))
      setNotice({ kind: 'info', text: article.isBookmarked ? '已从收藏移除。' : '已加入收藏。' })
    } catch (error) {
      showError(error)
    }
  }

  async function toggleRead(article: Article) {
    try {
      setArticles(await window.biofrontier.articles.read(article.id, !article.isRead))
    } catch (error) {
      showError(error)
    }
  }

  async function openArticle(article: Article) {
    try {
      if (!article.isRead) setArticles(await window.biofrontier.articles.read(article.id, true))
      await window.biofrontier.articles.open(article.id)
    } catch (error) {
      showError(error)
    }
  }

  async function download(article: Article) {
    setWorkingId(article.id)
    try {
      const result = await window.biofrontier.articles.download(article.id)
      setNotice({ kind: result.ok ? 'info' : 'error', text: result.message })
      setArticles(await window.biofrontier.articles.list())
    } catch (error) {
      showError(error)
    } finally {
      setWorkingId(null)
    }
  }

  async function summarize(article: Article) {
    if (!settings.hasApiKey) {
      setNotice({ kind: 'error', text: '请先在设置中配置外部 AI 服务和 API Key。' })
      setTab('settings')
      return
    }
    if (!await confirmExternalAi(settings.aiProvider)) return
    setWorkingId(article.id)
    setNotice(null)
    try {
      await window.biofrontier.ai.summarize(article.id)
      setArticles(await window.biofrontier.articles.list())
    } catch (error) {
      showError(error)
      if (errorText(error).includes('API Key')) setTab('settings')
    } finally {
      setWorkingId(null)
    }
  }

  function showError(error: unknown) {
    setNotice({ kind: 'error', text: errorText(error) })
  }

  async function confirmExternalAi(provider: AiProvider): Promise<boolean> {
    try {
      if (await window.biofrontier.ai.disclosureAccepted(provider)) return true
      if (aiConsentResolver.current) return false
      return await new Promise<boolean>((resolve) => {
        aiConsentResolver.current = resolve
        setAiConsentProvider(provider)
      })
    } catch (error) {
      showError(error)
      return false
    }
  }

  async function resolveExternalAiConsent(remember: boolean | null) {
    const provider = aiConsentProvider
    const resolve = aiConsentResolver.current
    aiConsentResolver.current = null
    setAiConsentProvider(null)
    if (!provider || !resolve || remember === null) {
      resolve?.(false)
      return
    }
    try {
      if (remember) await window.biofrontier.ai.acceptDisclosure(provider)
      else await window.biofrontier.ai.grantOnce(provider)
      resolve(true)
    } catch (error) {
      showError(error)
      resolve(false)
    }
  }

  async function runLocalClassification(showNotice = true) {
    try {
      const status = await window.biofrontier.classifier.status()
      if (!status.installed) return
      const result = await window.biofrontier.classifier.run()
      setArticles(await window.biofrontier.articles.list())
      if (showNotice) setNotice({ kind: result.failed ? 'error' : 'info', text: `本地分类完成：${result.processed} 条${result.failed ? `，失败 ${result.failed} 条` : ''}` })
    } catch (error) {
      if (showNotice) showError(error)
    }
  }

  const classified = useMemo(() => articles.map((article) => ({ article, insight: classifyArticle(article, settings.topics, settings.classificationMode) })), [articles, settings.topics, settings.classificationMode])
  const sourceOptions = useMemo(() => [...new Set(articles.map((article) => article.source))].sort((a, b) => a.localeCompare(b)), [articles])
  const primaryCounts = useMemo(() => PRIMARY_CATEGORIES.filter((label) => label !== '待确认').map((label) => ({
    label,
    count: classified.filter(({ article, insight }) => (tab !== 'favorites' || article.isBookmarked) && insight.primaryCategory === label).length
  })).filter((item) => item.count > 0), [classified, tab])
  const secondaryCounts = useMemo(() => draftFilters.primary.flatMap((primary) => secondaryCategories(primary).map((label) => ({
    label,
    primary,
    count: classified.filter(({ article, insight }) => (tab !== 'favorites' || article.isBookmarked) && insight.primaryCategory === primary && insight.secondaryCategory === label).length
  }))).filter((item) => item.count > 0), [classified, draftFilters.primary, tab])
  const classificationStatusCounts = useMemo(() => CLASSIFICATION_STATUS_OPTIONS.map((option) => ({
    ...option,
    count: classified.filter(({ article }) => (tab !== 'favorites' || article.isBookmarked) && classificationStatus(article) === option.value).length
  })), [classified, tab])

  const visible = useMemo(() => filterArticles(classified, tab, deferredSearch, filters), [classified, deferredSearch, tab, filters])
  const draftVisibleCount = useMemo(() => filterArticles(classified, tab, deferredSearch, draftFilters).length, [classified, deferredSearch, tab, draftFilters])
  const renderedVisible = useMemo(() => visible.slice(0, renderLimit), [visible, renderLimit])
  const scopedTotal = useMemo(() => tab === 'favorites' ? articles.filter((article) => article.isBookmarked).length : articles.length, [articles, tab])
  const searchPending = search !== deferredSearch

  useEffect(() => {
    setRenderLimit(INITIAL_ARTICLE_BATCH)
  }, [tab, deferredSearch, filters])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || renderedVisible.length >= visible.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRenderLimit((current) => Math.min(current + ARTICLE_BATCH_SIZE, visible.length))
      }
    }, { rootMargin: '500px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [renderedVisible.length, visible.length])

  const activeFilterCount = countActiveFilters(filters)
  const activeFilterChips = filterChips(filters)

  function openFilters() {
    setDraftFilters(copyFilters(filters))
    setFilterOpen(true)
  }

  function clearFilters() {
    setFilters(copyFilters(EMPTY_FILTERS))
    setDraftFilters(copyFilters(EMPTY_FILTERS))
  }

  function removeFilterChip(chip: FilterChip) {
    setFilters((current) => removeChip(current, chip))
  }

  if (!legalStatus) return <div className="legal-loading"><div className="brand-mark">B</div><strong>BioFrontier</strong><span>{startupError || '正在读取应用协议…'}</span></div>
  if (!legalStatus.accepted) return <AgreementGate status={legalStatus} working={legalWorking} error={startupError} onAccept={() => void acceptLegalAgreement()} onQuit={() => void window.biofrontier.legal.quit()} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <strong>BioFrontier</strong>
            <span>个人生物前沿阅读台</span>
          </div>
        </div>
        <nav>
          <NavButton active={tab === 'latest'} onClick={() => setTab('latest')} icon="⌁" label="最新动态" count={articles.filter((a) => !a.isRead).length} />
          <NavButton active={tab === 'favorites'} onClick={() => setTab('favorites')} icon="♡" label="我的收藏" count={articles.filter((a) => a.isBookmarked).length} />
          <NavButton active={tab === 'match'} onClick={() => setTab('match')} icon="◎" label="AI 需求匹配" />
          <NavButton active={tab === 'research'} onClick={() => setTab('research')} icon="◫" label="AI 专题速报" />
          <NavButton active={tab === 'sources'} onClick={() => setTab('sources')} icon="⌘" label="来源管理" />
          <NavButton active={tab === 'settings'} onClick={() => setTab('settings')} icon="⚙" label="设置" />
        </nav>
        <div className="sidebar-bottom">
          <button className="profile-card" onClick={() => setProfileOpen(true)}>
            <ProfileAvatar profile={profile} />
            <span><strong>{profile.nickname}</strong><small>{profile.tagline}</small></span>
            <b aria-hidden="true">›</b>
          </button>
          <div className="sidebar-footer">
            <span className={`status-dot ${settings.hasApiKey ? 'connected' : ''}`} />
            {AI_PROVIDER_LABELS[settings.aiProvider]} {settings.hasApiKey ? '已配置' : '未配置'}
          </div>
        </div>
      </aside>

      <main className="main-content">
        {notice && (
          <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="关闭提示">×</button>
          </div>
        )}

        {(tab === 'latest' || tab === 'favorites') && (
          <>
            <header className="page-header">
              <div>
                <p className="eyebrow">{tab === 'latest' ? 'DISCOVER' : 'LIBRARY'}</p>
                <h1>{tab === 'latest' ? '最新生物前沿' : '我的收藏'}</h1>
                <p>{tab === 'latest' ? '来自你启用的公开学术来源，聚焦最近的前沿进展' : '你保存的文章、网页与 AI 初读结果'}</p>
              </div>
              {tab === 'latest' && (
                <button className="primary-button" onClick={() => void syncArticles()} disabled={syncing}>
                  {syncing ? '正在同步…' : '同步最新内容'}
                </button>
              )}
            </header>
            <div className="toolbar">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、摘要、作者或主题" />
              <div className="toolbar-actions">
                <span aria-live="polite">{searchPending ? '正在筛选…' : `显示 ${renderedVisible.length} / ${visible.length} 条${visible.length !== scopedTotal ? `（当前范围共 ${scopedTotal} 条）` : ''}`}</span>
                <button className={`filter-trigger ${activeFilterCount ? 'active' : ''}`} onClick={openFilters} aria-haspopup="dialog">
                  <span aria-hidden="true">≡</span> 筛选{activeFilterCount ? ` ${activeFilterCount}` : ''}
                </button>
              </div>
            </div>
            {activeFilterChips.length > 0 && (
              <div className="active-filters" aria-label="已生效筛选">
                {activeFilterChips.map((chip) => (
                  <button key={`${chip.kind}-${chip.value}`} onClick={() => removeFilterChip(chip)} title="移除此条件">
                    {chip.label}<span aria-hidden="true">×</span>
                  </button>
                ))}
                <button className="clear-all-chips" onClick={clearFilters}>清除全部</button>
              </div>
            )}
            <section className="article-list">
              {visible.length ? renderedVisible.map(({ article, insight }) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  insight={insight}
                  working={workingId === article.id}
                  onOpen={() => void openArticle(article)}
                  onRead={() => void toggleRead(article)}
                  onBookmark={() => void toggleBookmark(article)}
                  onDownload={() => void download(article)}
                  onSummarize={() => void summarize(article)}
                />
              )) : <EmptyState text={tab === 'favorites' ? '还没有收藏内容。' : '没有找到符合条件的记录。'} />}
              {renderedVisible.length < visible.length && (
                <div className="load-more" ref={loadMoreRef}>
                  <button onClick={() => setRenderLimit((current) => Math.min(current + ARTICLE_BATCH_SIZE, visible.length))}>
                    继续加载（尚有 {visible.length - renderedVisible.length} 条）
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'match' && (
          <MatchPage
            hasApiKey={settings.hasApiKey}
            provider={settings.aiProvider}
            onBeforeRun={() => confirmExternalAi(settings.aiProvider)}
            onOpen={(id) => {
              const article = articles.find((item) => item.id === id)
              if (article) void openArticle(article)
            }}
            onConfigure={() => setTab('settings')}
            onError={showError}
          />
        )}

        {tab === 'research' && <ResearchPage settings={settings} onBeforeExternalAi={() => confirmExternalAi(settings.aiProvider)} onConfigure={() => setTab('settings')} onError={showError} />}

        {tab === 'sources' && (
          <SourcesPage
            onSync={syncArticles}
            onImported={async () => {
              setArticles(await window.biofrontier.articles.list())
              setNotice({ kind: 'info', text: '网页已加入收藏。' })
            }}
            onNotice={(text) => setNotice({ kind: 'info', text })}
            onError={showError}
          />
        )}

        {tab === 'settings' && (
          <SettingsPage
            initial={settings}
            onReviewLegal={() => setLegalReviewOpen(true)}
            onBeforeExternalAi={() => confirmExternalAi(settings.aiProvider)}
            onArticlesChanged={async () => setArticles(await window.biofrontier.articles.list())}
            onSaved={(value) => {
              setSettings(value)
              setNotice({ kind: 'info', text: '设置已保存。新的关注范围会在下次同步时生效。' })
            }}
            onError={showError}
          />
        )}
      </main>
      {filterOpen && (tab === 'latest' || tab === 'favorites') && (
        <FilterDrawer
          filters={draftFilters}
          setFilters={setDraftFilters}
          primaryCounts={primaryCounts}
          secondaryCounts={secondaryCounts}
          classificationStatusCounts={classificationStatusCounts}
          sourceOptions={sourceOptions}
          resultCount={draftVisibleCount}
          onClose={() => setFilterOpen(false)}
          onReset={() => setDraftFilters(copyFilters(EMPTY_FILTERS))}
          onApply={() => {
            setFilters(copyFilters(draftFilters))
            setFilterOpen(false)
          }}
        />
      )}
      {profileOpen && <ProfileModal profile={profile} onChanged={setProfile} onClose={() => setProfileOpen(false)} onError={showError} />}
      {legalReviewOpen && <LegalReviewModal status={legalStatus} onClose={() => setLegalReviewOpen(false)} />}
      {aiConsentProvider && <AiConsentModal provider={aiConsentProvider} onCancel={() => void resolveExternalAiConsent(null)} onAccept={(remember) => resolveExternalAiConsent(remember)} />}
    </div>
  )
}

function AgreementGate({ status, working, error, onAccept, onQuit }: {
  status: LegalStatus
  working: boolean
  error: string
  onAccept: () => void
  onQuit: () => void
}) {
  const [document, setDocument] = useState<'terms' | 'privacy'>('terms')
  const [checked, setChecked] = useState(false)
  return <main className="agreement-gate">
    <section className="agreement-card">
      <header><div className="brand-mark">B</div><div><h1>欢迎使用 BioFrontier</h1><span>进入应用前，请阅读并决定是否接受以下内容</span></div></header>
      <div className="agreement-tabs" role="tablist">
        <button role="tab" aria-selected={document === 'terms'} className={document === 'terms' ? 'selected' : ''} onClick={() => setDocument('terms')}>应用使用协议</button>
        <button role="tab" aria-selected={document === 'privacy'} className={document === 'privacy' ? 'selected' : ''} onClick={() => setDocument('privacy')}>隐私说明</button>
      </div>
      <LegalDocument content={document === 'terms' ? status.terms : status.privacy} />
      <label className="agreement-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />我已阅读并同意《应用使用协议》和《隐私说明》</label>
      {error && <p className="agreement-error">{error}</p>}
      <footer><button onClick={onQuit}>不同意并退出</button><button className="primary-button" onClick={onAccept} disabled={!checked || working}>{working ? '正在进入…' : '同意并进入应用'}</button></footer>
    </section>
  </main>
}

function LegalDocument({ content }: { content: string }) {
  return <div className="legal-document" tabIndex={0}>{content.split(/\r?\n/).map((line, index) => {
    if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>
    if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>
    if (line.startsWith('- ')) return <p className="legal-bullet" key={index}>{line.slice(2)}</p>
    if (!line.trim()) return <span className="legal-space" key={index} />
    return <p key={index}>{line}</p>
  })}</div>
}

function LegalReviewModal({ status, onClose }: { status: LegalStatus; onClose: () => void }) {
  const [document, setDocument] = useState<'terms' | 'privacy'>('terms')
  return <div className="profile-overlay" role="presentation" onMouseDown={onClose}>
    <section className="legal-review-modal" role="dialog" aria-modal="true" aria-labelledby="legal-review-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">LEGAL & PRIVACY</p><h2 id="legal-review-title">协议与隐私说明</h2></div><button onClick={onClose} aria-label="关闭协议说明">×</button></header>
      <div className="agreement-tabs" role="tablist"><button role="tab" aria-selected={document === 'terms'} className={document === 'terms' ? 'selected' : ''} onClick={() => setDocument('terms')}>应用使用协议</button><button role="tab" aria-selected={document === 'privacy'} className={document === 'privacy' ? 'selected' : ''} onClick={() => setDocument('privacy')}>隐私说明</button></div>
      <LegalDocument content={document === 'terms' ? status.terms : status.privacy} />
      <footer><span>已接受版本：{status.version}{status.acceptedAt ? ` · ${formatDateTime(status.acceptedAt)}` : ''}</span><button className="primary-button" onClick={onClose}>关闭</button></footer>
    </section>
  </div>
}

function AiConsentModal({ provider, onCancel, onAccept }: {
  provider: AiProvider
  onCancel: () => void
  onAccept: (remember: boolean) => Promise<void>
}) {
  const [remember, setRemember] = useState(false)
  const [working, setWorking] = useState(false)
  async function accept() {
    setWorking(true)
    try { await onAccept(remember) } finally { setWorking(false) }
  }
  return <div className="profile-overlay" role="presentation">
    <section className="ai-consent-modal" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title">
      <p className="eyebrow">EXTERNAL AI</p>
      <h2 id="ai-consent-title">发送给 {AI_PROVIDER_LABELS[provider]} 前请确认</h2>
      <p>本次任务可能把论文标题与摘要、来源分类、你的关注方向或专题问题发送给 {AI_PROVIDER_LABELS[provider]}。数据处理和费用受该服务商的条款、隐私政策及计费规则约束。</p>
      <div className="consent-boundary"><strong>BioFrontier 不会自动发送</strong><span>只有你主动点击外部 AI 功能时才会发送该次任务所需内容。</span></div>
      <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />记住我的选择，以后不再弹出此确认框</label>
      <footer><button onClick={onCancel} disabled={working}>取消</button><button className="primary-button" onClick={() => void accept()} disabled={working}>{working ? '正在确认…' : remember ? '同意并记住' : '仅本次同意'}</button></footer>
    </section>
  </div>
}

function ProfileAvatar({ profile, large = false }: { profile: UserProfile; large?: boolean }) {
  return profile.avatarDataUrl
    ? <img className={`profile-avatar ${large ? 'large' : ''}`} src={profile.avatarDataUrl} alt="本地用户头像" />
    : <span className={`profile-avatar profile-avatar-fallback ${large ? 'large' : ''}`}>{profile.nickname.trim().slice(0, 1).toUpperCase() || '研'}</span>
}

function ProfileModal({ profile, onChanged, onClose, onError }: { profile: UserProfile; onChanged: (profile: UserProfile) => void; onClose: () => void; onError: (error: unknown) => void }) {
  const [nickname, setNickname] = useState(profile.nickname)
  const [tagline, setTagline] = useState(profile.tagline)
  const [working, setWorking] = useState(false)

  async function chooseAvatar() {
    setWorking(true)
    try {
      const next = await window.biofrontier.profile.chooseAvatar()
      if (next) onChanged(next)
    } catch (error) { onError(error) } finally { setWorking(false) }
  }

  async function removeAvatar() {
    try { onChanged(await window.biofrontier.profile.removeAvatar()) } catch (error) { onError(error) }
  }

  async function save() {
    setWorking(true)
    try {
      onChanged(await window.biofrontier.profile.save({ nickname, tagline }))
      onClose()
    } catch (error) { onError(error) } finally { setWorking(false) }
  }

  return <div className="profile-overlay" role="presentation" onMouseDown={onClose}>
    <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="profile-close" onClick={onClose} aria-label="关闭个人资料">×</button>
      <div className="profile-avatar-editor">
        <ProfileAvatar profile={profile} large />
        <div><button onClick={() => void chooseAvatar()} disabled={working}>选择本地头像</button>{profile.avatarDataUrl && <button onClick={() => void removeAvatar()}>移除</button>}</div>
      </div>
      <p className="eyebrow">LOCAL PROFILE</p>
      <h2 id="profile-title">我的研究身份</h2>
      <p>仅保存在这台电脑，不创建账号，也不会随 AI 请求发送。</p>
      <label>昵称<input aria-label="昵称" maxLength={32} value={nickname} onChange={(event) => setNickname(event.target.value)} /></label>
      <label>个人说明<input aria-label="个人说明" maxLength={48} value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="例如：发育生物学 · 干细胞" /></label>
      <button className="primary-button profile-save" onClick={() => void save()} disabled={working || !nickname.trim()}>{working ? '正在保存…' : '保存本地资料'}</button>
    </section>
  </div>
}

function FilterDrawer({ filters, setFilters, primaryCounts, secondaryCounts, classificationStatusCounts, sourceOptions, resultCount, onClose, onReset, onApply }: {
  filters: Filters
  setFilters: Dispatch<SetStateAction<Filters>>
  primaryCounts: Array<{ label: string; count: number }>
  secondaryCounts: Array<{ label: string; primary: string; count: number }>
  classificationStatusCounts: Array<{ value: Exclude<ClassificationStatusFilter, 'all'>; label: string; count: number }>
  sourceOptions: string[]
  resultCount: number
  onClose: () => void
  onReset: () => void
  onApply: () => void
}) {
  function togglePrimary(primary: string) {
    setFilters((current) => {
      const primaryValues = toggleValue(current.primary, primary)
      const allowedSecondary = new Set(primaryValues.flatMap((value) => [...secondaryCategories(value)]))
      return { ...current, primary: primaryValues, secondary: current.secondary.filter((value) => allowedSecondary.has(value)) }
    })
  }

  return (
    <div className="filter-overlay" role="presentation" onMouseDown={onClose}>
      <aside className="filter-drawer" role="dialog" aria-modal="true" aria-labelledby="filter-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="filter-drawer-header">
          <div><span>FILTER</span><h2 id="filter-drawer-title">筛选内容</h2></div>
          <button onClick={onClose} aria-label="关闭筛选">×</button>
        </header>
        <div className="filter-drawer-body">
          <section className="drawer-section">
            <div className="drawer-section-title"><h3>分类状态</h3><small>“待确认”不再作为学科方向</small></div>
            <div className="choice-grid status-choices">
              <button className={filters.classificationStatus === 'all' ? 'selected' : ''} onClick={() => setFilters((value) => ({ ...value, classificationStatus: 'all' }))}>全部状态</button>
              {classificationStatusCounts.map((option) => (
                <button key={option.value} className={filters.classificationStatus === option.value ? 'selected' : ''} onClick={() => setFilters((value) => ({ ...value, classificationStatus: option.value }))}>
                  <span>{option.label}</span><em>{option.count}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="drawer-section">
            <div className="drawer-section-title"><h3>一级研究领域</h3><small>可多选</small></div>
            <div className="check-list">
              {primaryCounts.map((topic) => (
                <label key={topic.label}>
                  <input type="checkbox" checked={filters.primary.includes(topic.label)} onChange={() => togglePrimary(topic.label)} />
                  <span>{topic.label}</span><em>{topic.count}</em>
                </label>
              ))}
            </div>
          </section>

          {filters.primary.length > 0 && (
            <section className="drawer-section">
              <div className="drawer-section-title"><h3>二级研究方向</h3><small>从已选一级领域中细分</small></div>
              <div className="secondary-choice-groups">
                {filters.primary.map((primary) => {
                  const topics = secondaryCounts.filter((topic) => topic.primary === primary)
                  if (!topics.length) return null
                  return <div key={primary}><strong>{primary}</strong><div className="choice-pills">{topics.map((topic) => (
                    <button key={topic.label} className={filters.secondary.includes(topic.label) ? 'selected' : ''} onClick={() => setFilters((current) => ({ ...current, secondary: toggleValue(current.secondary, topic.label) }))}>
                      {topic.label}<em>{topic.count}</em>
                    </button>
                  ))}</div></div>
                })}
              </div>
            </section>
          )}

          <section className="drawer-section">
            <h3>来源与相关度</h3>
            <div className="drawer-select-grid">
              <label>相关程度<select aria-label="相关程度" value={filters.relevance} onChange={(event) => setFilters((value) => ({ ...value, relevance: event.target.value as RelevanceFilter }))}>
                <option value="all">全部相关度</option><option value="high">高度相关</option><option value="possible">可能相关</option><option value="other">低相关/未匹配</option>
              </select></label>
              <label>内容来源<select aria-label="内容来源" value={filters.source} onChange={(event) => setFilters((value) => ({ ...value, source: event.target.value }))}>
                <option value="all">全部来源</option>{sourceOptions.map((source) => <option value={source} key={source}>{source}</option>)}
              </select></label>
            </div>
          </section>

          <details className="drawer-more">
            <summary>阅读状态、时间和类型</summary>
            <div className="drawer-select-grid">
              <label>阅读状态<select aria-label="信息状态" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value as StatusFilter }))}>
                <option value="all">全部状态</option><option value="unread">未读</option><option value="read">已读</option><option value="bookmarked">已收藏</option>
              </select></label>
              <label>时间范围<select aria-label="时间范围" value={filters.time} onChange={(event) => setFilters((value) => ({ ...value, time: event.target.value as TimeFilter }))}>
                <option value="all">不限时间</option><option value="1">最近 24 小时</option><option value="3">最近 3 天</option><option value="7">最近 7 天</option><option value="14">最近 14 天</option><option value="30">最近 30 天</option>
              </select></label>
              <label>内容类型<select aria-label="内容类型" value={filters.type} onChange={(event) => setFilters((value) => ({ ...value, type: event.target.value as TypeFilter }))}>
                <option value="all">全部类型</option><option value="journal">正式论文/网页</option><option value="preprint">预印本</option>
              </select></label>
            </div>
          </details>
        </div>
        <footer className="filter-drawer-footer">
          <button className="drawer-reset" onClick={onReset}>重置</button>
          <button className="drawer-apply" onClick={onApply}>查看 {resultCount} 篇</button>
        </footer>
      </aside>
    </div>
  )
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count?: number }) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span><span>{label}</span>{count !== undefined && <em>{count}</em>}
    </button>
  )
}

function ArticleCard({ article, insight, working, onOpen, onRead, onBookmark, onDownload, onSummarize }: {
  article: Article
  insight: ArticleInsight
  working: boolean
  onOpen: () => void
  onRead: () => void
  onBookmark: () => void
  onDownload: () => void
  onSummarize: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={`article-card ${article.isRead ? 'read' : 'unread'}`}>
      <div className="article-meta">
        {!article.isRead && <span className="unread-badge">未读</span>}
        <span className={`source-badge ${article.source.toLowerCase()}`}>{article.source}</span>
        {article.isPreprint && <span className="preprint-badge">预印本</span>}
        {insight.relevance !== 'other' && <span className={`relevance-badge ${insight.relevance}`}>{insight.relevance === 'high' ? '高度相关' : '可能相关'}</span>}
        <time>{articleDateLabel(article)}</time>
      </div>
      <div className="classification-path" title={insight.relatedTags.length ? `关联标签：${insight.relatedTags.join('、')}` : undefined}>
        <span className="primary-category-badge">{insight.primaryCategory}</span>
        <span className="category-arrow">›</span>
        <span className="secondary-category-badge">{insight.secondaryCategory}</span>
        {insight.isAi && <span className="local-model-badge">{insight.aiLabel || 'AI 分类'}</span>}
      </div>
      <h2>{article.title}</h2>
      {article.authors && <p className="authors">{article.authors}</p>}
      {article.abstract && (
        <p className={`abstract ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
          {article.abstract}
        </p>
      )}
      {article.summary && (
        <details className="summary-box" open>
          <summary>AI 辅助生成 · 初步解读</summary>
          <div>{article.summary}</div>
          <small>仅依据当前标题和摘要，请核对原始来源。</small>
        </details>
      )}
      {article.downloadPath && <p className="saved-path">已保存：{article.downloadPath}</p>}
      <div className="article-actions">
        <button className="link-button" onClick={onOpen}>在 Chrome 打开 ↗</button>
        <div>
          <button onClick={onRead}>{article.isRead ? '标为未读' : '标为已读'}</button>
          <button onClick={onBookmark}>{article.isBookmarked ? '已收藏' : '收藏'}</button>
          <button onClick={onDownload} disabled={working}>{working ? '处理中…' : article.pdfUrl ? '下载 PDF' : '保存网页'}</button>
          <button className="ai-button" onClick={onSummarize} disabled={working}>{working ? '处理中…' : article.summary ? '重新总结' : 'AI 初步了解'}</button>
        </div>
      </div>
    </article>
  )
}

function MatchPage({ hasApiKey, provider, onBeforeRun, onOpen, onConfigure, onError }: {
  hasApiKey: boolean
  provider: AiProvider
  onBeforeRun: () => Promise<boolean>
  onOpen: (id: string) => void
  onConfigure: () => void
  onError: (error: unknown) => void
}) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MatchResult | null>(null)

  async function runMatch() {
    if (!query.trim()) return
    if (!await onBeforeRun()) return
    setLoading(true)
    setResult(null)
    try {
      setResult(await window.biofrontier.ai.match(query))
    } catch (error) {
      onError(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="page-header compact">
        <div>
          <p className="eyebrow">PRELIMINARY MATCH</p>
          <h1>AI 需求匹配</h1>
          <p>根据最新记录的标题和摘要做初步筛选，结果不代替原文判断。</p>
        </div>
      </header>
      <section className="match-panel">
        <label htmlFor="need">你现在需要了解什么？</label>
        <textarea id="need" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：寻找近两周使用人体样本研究早期阿尔茨海默病微胶质细胞变化的工作" />
        <div className="match-actions">
          <span>系统最多分析最近 50 条有摘要的记录</span>
          {hasApiKey
            ? <button className="primary-button" onClick={() => void runMatch()} disabled={loading || !query.trim()}>{loading ? '正在匹配…' : '开始匹配'}</button>
            : <button className="primary-button" onClick={onConfigure}>先配置 AI 服务</button>}
        </div>
      </section>
      {result && (
        <section className="match-results">
          <div className="ai-disclosure"><strong>AI 辅助生成 · {AI_PROVIDER_LABELS[provider]}</strong><span>仅用于初步匹配，请根据下方原始来源自行核对。</span></div>
          <div className="result-overview"><strong>初步判断</strong><p>{result.overview}</p></div>
          {result.matches.map((item) => (
            <article className="match-card" key={item.article.id}>
              <div className="score">{item.score}<span>/100</span></div>
              <div>
                <span className="source-inline">{item.article.source} · {articleDateLabel(item.article)}</span>
                <h2>{item.article.title}</h2>
                <p><strong>匹配原因：</strong>{item.reason}</p>
                {item.caution && <p className="caution"><strong>需要核对：</strong>{item.caution}</p>}
                <button className="link-button" onClick={() => onOpen(item.article.id)}>打开原始来源 ↗</button>
              </div>
            </article>
          ))}
          {!result.matches.length && <EmptyState text="AI 没有找到足够相关的候选记录，可以调整需求或先同步更多内容。" />}
        </section>
      )}
    </>
  )
}

const EMPTY_RESEARCH_STATUS: ResearchStatus = { phase: 'idle', running: false, progress: 0, message: '尚未开始专题速报。', fetched: 0, selected: 0, analyzed: 0 }

function ResearchPage({ settings, onBeforeExternalAi, onConfigure, onError }: {
  settings: Settings
  onBeforeExternalAi: () => Promise<boolean>
  onConfigure: () => void
  onError: (error: unknown) => void
}) {
  const [query, setQuery] = useState('')
  const [days, setDays] = useState(7)
  const [engine, setEngine] = useState<ResearchEngine>('local')
  const [status, setStatus] = useState<ResearchStatus>(EMPTY_RESEARCH_STATUS)
  const [reports, setReports] = useState<ResearchReport[]>([])
  const [selectedReportId, setSelectedReportId] = useState('')
  const [exportedPath, setExportedPath] = useState('')
  const [modelStatus, setModelStatus] = useState<LocalClassifierStatus | null>(null)

  useEffect(() => {
    let active = true
    async function refresh() {
      try {
        const [nextStatus, nextReports, nextModelStatus] = await Promise.all([window.biofrontier.research.status(), window.biofrontier.research.reports(), window.biofrontier.classifier.status()])
        if (!active) return
        setStatus(nextStatus)
        setReports(nextReports)
        setModelStatus(nextModelStatus)
        if (nextStatus.report) setSelectedReportId(nextStatus.report.id)
      } catch (error) { if (active) onError(error) }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1200)
    return () => { active = false; clearInterval(timer) }
  }, [])

  async function start() {
    try {
      if (engine === 'local' && !modelStatus?.installed) {
        onConfigure()
        return
      }
      if (engine === 'api') {
        if (!settings.hasApiKey) {
          onConfigure()
          return
        }
        if (!await onBeforeExternalAi()) return
      }
      setSelectedReportId('')
      setStatus(await window.biofrontier.research.start({ query, days, maxMinutes: 20, engine }))
    } catch (error) { onError(error) }
  }

  async function cancel() {
    try { setStatus(await window.biofrontier.research.cancel()) } catch (error) { onError(error) }
  }

  async function exportReport(id: string) {
    try {
      const value = await window.biofrontier.research.export(id)
      if (value) setExportedPath(value)
    } catch (error) { onError(error) }
  }

  const report = status.running && !selectedReportId ? undefined : status.report?.id === selectedReportId ? status.report : reports.find((item) => item.id === selectedReportId) || reports[0]
  const remaining = status.running && status.deadlineAt ? formatRemaining(status.deadlineAt) : ''
  const ready = engine === 'api' ? settings.hasApiKey : Boolean(modelStatus?.installed)

  return <>
    <header className="page-header compact">
      <div><p className="eyebrow">AI RESEARCH BRIEF</p><h1>AI 专题速报</h1><p>联网搜集公开标题与摘要，再由本地模型或你选择的外部 API 整理成带原始来源的初步报告。</p></div>
    </header>
    <section className="research-compose">
      <label htmlFor="research-query">这次要追踪什么研究问题？</label>
      <textarea id="research-query" value={query} onChange={(event) => setQuery(event.target.value)} disabled={status.running} placeholder="例如：最近一周，人类类器官中用于研究神经发育的空间转录组方法有哪些新进展？" />
      <div className="research-engine-choices" role="group" aria-label="专题生成方式">
        <button className={engine === 'local' ? 'selected' : ''} onClick={() => setEngine('local')} disabled={status.running}><strong>本地 AI</strong><small>内容留在本机 · 需要 GGUF</small></button>
        <button className={engine === 'api' ? 'selected' : ''} onClick={() => setEngine('api')} disabled={status.running}><strong>外部 API</strong><small>{AI_PROVIDER_LABELS[settings.aiProvider]} · {settings.aiModel}</small></button>
      </div>
      <div className="research-options">
        <label>搜集范围<select aria-label="专题搜集范围" value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={status.running}>
          {[1, 3, 5, 7, 10, 14].map((value) => <option key={value} value={value}>最近 {value} 天</option>)}
        </select></label>
        <div><strong>硬性时限：20分钟</strong><small>{engine === 'api'
          ? settings.hasApiKey ? `将按需发送问题和候选摘要；${AI_PROVIDER_LABELS[settings.aiProvider]} 可能计费` : '请先在设置中配置外部 AI API Key'
          : modelStatus?.installed ? `${modelStatus.modelName} · 到时自动交付已有结果` : '请先在设置中选择 GGUF 模型和 llama-server'}</small></div>
        {status.running
          ? <button className="research-cancel" onClick={() => void cancel()}>取消任务</button>
          : <button className="primary-button" onClick={() => void start()} disabled={query.trim().length < 4}>{!ready ? engine === 'api' ? '先配置外部 AI' : '先配置本地 AI' : engine === 'api' ? '使用 API 生成' : '使用本地 AI 生成'}</button>}
      </div>
    </section>

    {(status.phase !== 'idle' && status.phase !== 'completed') && <section className={`research-progress ${status.phase}`}>
      <div><strong>{status.message}</strong><span>{remaining}</span></div>
      <div className="progress-track"><i style={{ transform: `scaleX(${Math.max(0, Math.min(100, status.progress)) / 100})` }} /></div>
      <p>已取得 {status.fetched} 条 · 入选 {status.selected} 条 · 已分析 {status.analyzed} 条</p>
      {status.error && <p className="research-error">{status.error}</p>}
    </section>}

    {reports.length > 0 && <div className="research-history">
      <label>AI 历史报告<select value={selectedReportId || reports[0].id} onChange={(event) => setSelectedReportId(event.target.value)}>
        {reports.map((item) => <option key={item.id} value={item.id}>{formatDateTime(item.completedAt)} · {item.query}</option>)}
      </select></label>
    </div>}

    {exportedPath && <p className="research-exported">报告已导出：{exportedPath}</p>}
    {report && <ResearchReportView report={report} onExport={() => void exportReport(report.id)} />}
  </>
}

function ResearchReportView({ report, onExport }: { report: ResearchReport; onExport: () => void }) {
  const sections = [
    { title: '主要趋势', values: report.trends },
    { title: '分歧与不确定性', values: report.disagreements },
    { title: '研究空白', values: report.gaps },
    { title: '阅读时需要注意', values: report.cautions }
  ]
  const byId = new Map(report.sources.map((source) => [source.articleId, source]))
  return <article className="research-report">
    <header>
      <div><span>AI 生成 · {report.partial ? '限时部分报告' : '完整速报'}</span><h2>{report.query}</h2><p>{report.generatorModel || '本地模型'} · {formatDateTime(report.completedAt)} · 最近 {report.days} 天</p></div>
      <div className="report-header-actions"><div className="coverage"><strong>{report.coverage.analyzed}</strong><small>已分析摘要</small></div><button onClick={onExport}>导出 Markdown</button></div>
    </header>
    <div className="report-summary"><strong>速报摘要</strong><p>{report.summary}</p></div>
    <div className="report-section-grid">{sections.map((section) => <section key={section.title}><h3>{section.title}</h3>{section.values.length ? <ul>{section.values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p>现有摘要没有提供足够信息。</p>}</section>)}</div>
    {report.readingOrder.length > 0 && <section className="reading-order"><h3>建议优先阅读</h3>{report.readingOrder.map((item, index) => {
      const source = byId.get(item.articleId)
      return source ? <button key={item.articleId} onClick={() => void window.biofrontier.articles.open(item.articleId)}><b>{index + 1}</b><span><strong>{source.title}</strong><small>{source.source} · {formatDate(source.publishedAt)} · {item.reason}</small></span><em>↗</em></button> : null
    })}</section>}
    <details className="research-sources"><summary>查看全部 {report.sources.length} 个原始来源</summary><div>{report.sources.map((source) => <button key={source.articleId} onClick={() => void window.biofrontier.articles.open(source.articleId)}><span>{source.title}</span><small>{source.source} · {formatDate(source.publishedAt)}</small></button>)}</div></details>
    <footer>AI 辅助生成，仅依据公开标题和摘要，请核对原始来源。搜集 {report.coverage.fetched} 条，筛选 {report.coverage.selected} 条，分析 {report.coverage.analyzed} 条。{report.coverage.sourceErrors.length ? `未完成来源：${report.coverage.sourceErrors.join('；')}` : '所有启用来源均完成。'}</footer>
  </article>
}

function formatRemaining(deadlineAt: string): string {
  const seconds = Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000))
  return `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function SourcesPage({ onSync, onImported, onNotice, onError }: {
  onSync: () => Promise<void>
  onImported: () => Promise<void>
  onNotice: (text: string) => void
  onError: (error: unknown) => void
}) {
  const [sources, setSources] = useState<ContentSource[]>([])
  const [rssName, setRssName] = useState('')
  const [rssUrl, setRssUrl] = useState('')
  const [frequency, setFrequency] = useState<SyncFrequency>('startup')
  const [pageUrl, setPageUrl] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void window.biofrontier.sources.list().then(setSources).catch(onError)
  }, [])

  async function addRss() {
    if (!rssName.trim() || !rssUrl.trim()) return
    setWorking(true)
    try {
      const next = await window.biofrontier.sources.addRss({ name: rssName.trim(), url: rssUrl.trim(), frequency })
      setSources(next)
      setRssName('')
      setRssUrl('')
      const added = next.find((source) => source.kind === 'rss' && source.url === rssUrl.trim())
      onNotice(added?.lastError ? `来源已保存，但首次同步失败：${added.lastError}` : 'RSS/Atom 来源已添加并完成首次同步。')
    } catch (error) {
      onError(error)
    } finally {
      setWorking(false)
    }
  }

  async function updateSource(id: string, changes: { enabled?: boolean; frequency?: SyncFrequency }) {
    try { setSources(await window.biofrontier.sources.update(id, changes)) } catch (error) { onError(error) }
  }

  async function removeSource(id: string) {
    try {
      setSources(await window.biofrontier.sources.remove(id))
      onNotice('来源订阅已删除；此前收藏和获取的内容仍然保留。')
    } catch (error) { onError(error) }
  }

  async function importPage() {
    if (!pageUrl.trim()) return
    setWorking(true)
    try {
      await window.biofrontier.sources.importUrl(pageUrl.trim())
      setPageUrl('')
      await onImported()
    } catch (error) {
      onError(error)
    } finally {
      setWorking(false)
    }
  }

  async function syncNow() {
    setWorking(true)
    try {
      await onSync()
      setSources(await window.biofrontier.sources.list())
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <header className="page-header compact">
        <div>
          <p className="eyebrow">SOURCES</p>
          <h1>来源管理</h1>
          <p>管理内置来源、添加 RSS/Atom，或将单个网页直接加入收藏。</p>
        </div>
        <button className="primary-button" onClick={() => void syncNow()} disabled={working}>{working ? '正在处理…' : '立即同步全部'}</button>
      </header>

      <section className="source-list">
        <div className="compliance-note"><strong>来源与内容权利</strong><span>BioFrontier 只聚合公开元数据并将你主动保存的内容留在本机；摘要、网页和 PDF 的版权及再使用条件以原始来源和作者许可为准。</span></div>
        {sources.map((source) => (
          <article className={`source-card ${source.enabled ? '' : 'disabled'}`} key={source.id}>
            <div className="source-main">
              <span className={`source-kind ${source.kind}`}>{source.kind === 'builtin' ? '内置' : 'RSS'}</span>
              <div>
                <h2>{source.name}</h2>
                <p>{source.url || builtInDescription(source.id)}</p>
              </div>
            </div>
            <div className="source-controls">
              <label className="source-toggle">
                <input type="checkbox" checked={source.enabled} onChange={(event) => void updateSource(source.id, { enabled: event.target.checked })} />
                <span>{source.enabled ? '已启用' : '已关闭'}</span>
              </label>
              <select value={source.frequency} onChange={(event) => void updateSource(source.id, { frequency: event.target.value as SyncFrequency })}>
                <option value="manual">仅手动</option>
                <option value="startup">启动时</option>
                <option value="daily">每天一次</option>
              </select>
              {source.removable && <button className="danger-quiet" onClick={() => void removeSource(source.id)}>删除</button>}
            </div>
            <div className={`source-status ${source.lastError ? 'failed' : ''}`}>
              {source.lastError
                ? `上次失败：${source.lastError}`
                : source.lastSyncedAt
                  ? `最近同步：${formatDateTime(source.lastSyncedAt)}`
                  : '尚未同步'}
            </div>
          </article>
        ))}
      </section>

      <section className="source-add-grid">
        <div className="source-form">
          <h2>添加 RSS/Atom 来源</h2>
          <p>适用于期刊、机构和实验室提供的订阅地址。</p>
          <label htmlFor="rss-name">来源名称</label>
          <input id="rss-name" value={rssName} onChange={(event) => setRssName(event.target.value)} placeholder="例如 Nature Biotechnology" />
          <label htmlFor="rss-url">RSS/Atom 地址</label>
          <input id="rss-url" value={rssUrl} onChange={(event) => setRssUrl(event.target.value)} placeholder="https://example.org/feed.xml" />
          <label htmlFor="rss-frequency">同步频率</label>
          <select id="rss-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as SyncFrequency)}>
            <option value="manual">仅手动</option>
            <option value="startup">启动时</option>
            <option value="daily">每天一次</option>
          </select>
          <button className="primary-button" onClick={() => void addRss()} disabled={working || !rssName.trim() || !rssUrl.trim()}>添加并测试</button>
        </div>

        <div className="source-form">
          <h2>收藏单个网页</h2>
          <p>读取公开网页的标题和说明并加入收藏，不会创建持续订阅。</p>
          <label htmlFor="page-url">网页地址</label>
          <input id="page-url" value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder="https://example.org/article" />
          <button className="primary-button" onClick={() => void importPage()} disabled={working || !pageUrl.trim()}>读取并收藏</button>
          <div className="source-help">需要登录、验证码或付费墙的页面可能无法自动读取，但仍可在 Chrome 中手动保存。</div>
        </div>
      </section>
    </>
  )
}

function SettingsPage({ initial, onReviewLegal, onBeforeExternalAi, onSaved, onArticlesChanged, onError }: {
  initial: Settings
  onReviewLegal: () => void
  onBeforeExternalAi: () => Promise<boolean>
  onSaved: (settings: Settings) => void
  onArticlesChanged: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const [topics, setTopics] = useState(initial.topics.join('\n'))
  const [browser, setBrowser] = useState(initial.browser)
  const [libraryPath, setLibraryPath] = useState(initial.libraryPath)
  const [provider, setProvider] = useState<AiProvider>(initial.aiProvider)
  const [model, setModel] = useState(initial.aiModel)
  const [availableModels, setAvailableModels] = useState<AiModel[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [syncDays, setSyncDays] = useState(initial.syncDays)
  const [apiKey, setApiKey] = useState('')
  const [classificationMode, setClassificationMode] = useState<ClassificationMode>(initial.classificationMode)
  const [localAuto, setLocalAuto] = useState(initial.localClassifierAuto)
  const [localPersistent, setLocalPersistent] = useState(initial.localClassifierPersistent)
  const [allowPrivateSources, setAllowPrivateSources] = useState(initial.allowPrivateSources)
  const [classifierStatus, setClassifierStatus] = useState<LocalClassifierStatus | null>(null)
  const [apiClassifierStatus, setApiClassifierStatus] = useState<ApiClassifierStatus | null>(null)
  const [classifierWorking, setClassifierWorking] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTopics(initial.topics.join('\n'))
    setBrowser(initial.browser)
    setLibraryPath(initial.libraryPath)
    setProvider(initial.aiProvider)
    setModel(initial.aiModel)
    setSyncDays(initial.syncDays)
    setClassificationMode(initial.classificationMode)
    setLocalAuto(initial.localClassifierAuto)
    setLocalPersistent(initial.localClassifierPersistent)
    setAllowPrivateSources(initial.allowPrivateSources)
  }, [initial])

  useEffect(() => {
    setAvailableModels([])
    setModelStatus('')
  }, [provider])

  useEffect(() => {
    void refreshClassifierStatus()
    void refreshApiClassifierStatus()
    const timer = setInterval(() => { void refreshClassifierStatus(); void refreshApiClassifierStatus() }, 2500)
    return () => clearInterval(timer)
  }, [])

  async function refreshClassifierStatus() {
    try { setClassifierStatus(await window.biofrontier.classifier.status()) } catch { /* optional component */ }
  }

  async function refreshApiClassifierStatus() {
    try { setApiClassifierStatus(await window.biofrontier.classifier.apiStatus()) } catch { /* optional external service */ }
  }

  async function runClassifier() {
    setClassifierWorking(true)
    try {
      await window.biofrontier.settings.save({
        classificationMode: 'local',
        localClassifierAuto: localAuto,
        localClassifierPersistent: localPersistent
      })
      onSaved(await window.biofrontier.settings.get())
      await window.biofrontier.classifier.run()
      await onArticlesChanged()
      await refreshClassifierStatus()
    } catch (error) {
      onError(error)
    } finally {
      setClassifierWorking(false)
    }
  }

  async function runApiClassifier() {
    if (!initial.configuredProviders.includes(provider) && !apiKey.trim()) {
      setModelStatus('请先保存并测试 API Key。')
      return
    }
    if (apiKey.trim() || provider !== initial.aiProvider || model !== initial.aiModel) {
      setModelStatus('请先保存当前 API 服务商、模型和 Key，再开始分类。')
      return
    }
    if (!await onBeforeExternalAi()) return
    setClassifierWorking(true)
    try {
      await window.biofrontier.settings.save({ classificationMode: 'api' })
      setClassificationMode('api')
      onSaved(await window.biofrontier.settings.get())
      const result = await window.biofrontier.classifier.runApi()
      await onArticlesChanged()
      await refreshApiClassifierStatus()
      setModelStatus(`API 分类完成：${result.processed} 条${result.failed ? `，失败 ${result.failed} 条` : ''}`)
    } catch (error) { onError(error) } finally { setClassifierWorking(false) }
  }

  async function stopApiClassifier() {
    try { setApiClassifierStatus(await window.biofrontier.classifier.stopApi()) } catch (error) { onError(error) }
  }

  async function stopClassifier() {
    try { setClassifierStatus(await window.biofrontier.classifier.stop()) } catch (error) { onError(error) }
  }

  async function chooseLocalModel() {
    try {
      const status = await window.biofrontier.classifier.chooseModel()
      if (status) setClassifierStatus(status)
    } catch (error) { onError(error) }
  }

  async function chooseLocalRuntime() {
    try {
      const status = await window.biofrontier.classifier.chooseRuntime()
      if (status) setClassifierStatus(status)
    } catch (error) { onError(error) }
  }

  async function testLocalAi() {
    setClassifierWorking(true)
    try {
      setClassifierStatus(await window.biofrontier.classifier.test())
      setModelStatus('本地 AI 启动测试成功，显存已释放。')
    } catch (error) { onError(error) } finally { setClassifierWorking(false) }
  }

  async function clearLocalAi() {
    try {
      setClassifierStatus(await window.biofrontier.classifier.clearConfiguration())
      if (classificationMode === 'local') setClassificationMode('rules')
    } catch (error) { onError(error) }
  }

  async function chooseLibrary() {
    const value = await window.biofrontier.settings.chooseLibrary()
    if (value) setLibraryPath(value)
  }

  async function loadModels(showErrors = true) {
    setModelStatus('正在连接…')
    try {
      const values = await window.biofrontier.ai.models(provider, apiKey.trim() || undefined)
      setAvailableModels(values)
      setModelStatus(`连接成功 · ${values.length} 个文本模型`)
      if (!values.some((value) => value.id === model)) setModel(values[0]?.id || model)
    } catch (error) {
      setModelStatus('连接失败')
      if (showErrors) onError(error)
    }
  }

  async function removeApiKey() {
    try {
      await window.biofrontier.settings.setApiKey(provider, '')
      await window.biofrontier.ai.revokeDisclosure(provider)
      setApiKey('')
      setAvailableModels([])
      setModelStatus(`${AI_PROVIDER_LABELS[provider]} API Key 已从本机移除。`)
      onSaved(await window.biofrontier.settings.get())
    } catch (error) { onError(error) }
  }

  async function save() {
    setSaving(true)
    try {
      await window.biofrontier.settings.save({
        topics: topics.split(/[\n,，]/).map((value) => value.trim()).filter(Boolean),
        browser,
        libraryPath,
        aiProvider: provider,
        aiModel: model.trim() || defaultAiModel(provider),
        deepseekModel: provider === 'deepseek' ? model.trim() || 'deepseek-v4-flash' : initial.deepseekModel,
        syncDays,
        classificationMode,
        localClassifierAuto: localAuto,
        localClassifierPersistent: localPersistent,
        allowPrivateSources
      })
      if (apiKey.trim()) {
        await window.biofrontier.settings.setApiKey(provider, apiKey)
        setApiKey('')
      }
      onSaved(await window.biofrontier.settings.get())
    } catch (error) {
      onError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="page-header compact">
        <div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>管理关注范围、资料库、浏览器和 AI 接口。</p></div>
      </header>
      <section className="settings-grid">
        <div className="settings-card wide">
          <label htmlFor="topics">关注方向</label>
          <p>每行一个英文或中文主题；用于筛选 PubMed，也供所选分类引擎判断文章与你的相关程度。</p>
          <textarea id="topics" value={topics} onChange={(event) => setTopics(event.target.value)} />
        </div>
        <div className="settings-card">
          <label htmlFor="browser">打开原始来源</label>
          <select id="browser" value={browser} onChange={(event) => setBrowser(event.target.value as Settings['browser'])}>
            <option value="chrome">优先使用 Chrome</option>
            <option value="default">使用系统默认浏览器</option>
          </select>
          <label htmlFor="days">前沿内容同步范围</label>
          <select id="days" value={syncDays} onChange={(event) => setSyncDays(Number(event.target.value))}>
            <option value={1}>最近 1 天</option>
            <option value={3}>最近 3 天</option>
            <option value={5}>最近 5 天</option>
            <option value={7}>最近 7 天</option>
            <option value={10}>最近 10 天</option>
            <option value={14}>最近 14 天</option>
          </select>
          <p>默认7天；若数日未启动，会自动补抓遗漏内容，最长不超过14天。</p>
          <label className="advanced-option"><input type="checkbox" checked={allowPrivateSources} onChange={(event) => setAllowPrivateSources(event.target.checked)} /> 允许自定义来源访问本机或局域网</label>
          <p>高级选项，默认关闭。仅在你明确需要读取可信的内网 RSS/网页时开启。</p>
        </div>
        <div className="settings-card">
          <label>本地资料库</label>
          <p className="path-preview">{libraryPath || '尚未选择'}</p>
          <button onClick={() => void chooseLibrary()}>选择文件夹</button>
          <label>协议与隐私</label>
          <p>可随时重新查看当前版本的应用使用协议和隐私说明。</p>
          <button onClick={onReviewLegal}>查看协议与隐私说明</button>
        </div>
        <div className="settings-card wide">
          <div className="api-status-row">
            <div><label>外部 AI 服务</label><p>用于手动初读、需求匹配、API 分类和 API 专题速报；发送前会确认，Key 使用 Windows 安全存储。</p></div>
            <span className={initial.configuredProviders.includes(provider) ? 'configured' : ''}>{initial.configuredProviders.includes(provider) ? '已配置' : '未配置'}</span>
          </div>
          <div className="provider-choices" role="group" aria-label="AI 服务商">
            {(['deepseek', 'openai', 'anthropic'] as AiProvider[]).map((value) => <button key={value} className={provider === value ? 'selected' : ''} onClick={() => { setProvider(value); setModel(value === initial.aiProvider ? initial.aiModel : defaultAiModel(value)); setApiKey('') }}>
              <strong>{AI_PROVIDER_LABELS[value]}</strong><small>{initial.configuredProviders.includes(value) ? 'Key 已保存' : '未配置'}</small>
            </button>)}
          </div>
          <label htmlFor="api-key">{AI_PROVIDER_LABELS[provider]} API Key</label>
          <div className="api-key-row">
            <input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={initial.configuredProviders.includes(provider) ? '输入新 Key 可替换；留空保持不变' : `粘贴 ${AI_PROVIDER_LABELS[provider]} API Key`} />
            <button onClick={() => void loadModels()} disabled={!apiKey.trim() && !initial.configuredProviders.includes(provider)}>测试并读取模型</button>
          </div>
          {modelStatus && <p className={modelStatus === '连接失败' ? 'classifier-error' : ''}>{modelStatus}</p>}
          {availableModels.length > 0 && <><label htmlFor="known-model">可用模型</label><select id="known-model" value={availableModels.some((value) => value.id === model) ? model : ''} onChange={(event) => setModel(event.target.value)}>
            <option value="" disabled>选择模型</option>{availableModels.map((value) => <option key={value.id} value={value.id}>{value.name} · {value.id}</option>)}
          </select></>}
          <label htmlFor="model">模型 ID</label>
          <input id="model" value={model} onChange={(event) => setModel(event.target.value)} />
          <p>模型列表由服务商实时返回；也可手动填写模型ID。ChatGPT或Claude订阅不等同于API额度。</p>
          <div className="classifier-actions">
            <button onClick={() => void window.biofrontier.ai.revokeDisclosure(provider)}>重新显示首次数据发送提示</button>
            {initial.configuredProviders.includes(provider) && <button className="danger-quiet" onClick={() => void removeApiKey()}>移除这个 API Key</button>}
          </div>
        </div>
        <div className="settings-card wide classifier-settings">
          <div className="api-status-row">
            <div>
              <label>文章分类方式</label>
              <p>可使用轻量规则、本地模型或已配置的外部 API。外部 API 分类只会在你点击开始后运行，不会随同步自动发送。</p>
            </div>
            <span className={classificationMode !== 'rules' ? 'configured' : ''}>{classificationMode === 'rules' ? '基础规则' : classificationMode === 'local' ? '本地 AI' : '外部 API'}</span>
          </div>
          <div className="provider-choices classification-mode-choices" role="group" aria-label="文章分类方式">
            <button className={classificationMode === 'rules' ? 'selected' : ''} onClick={() => setClassificationMode('rules')}><strong>基础规则</strong><small>无需模型或费用</small></button>
            <button className={classificationMode === 'local' ? 'selected' : ''} onClick={() => setClassificationMode('local')}><strong>本地 AI</strong><small>不发送摘要</small></button>
            <button className={classificationMode === 'api' ? 'selected' : ''} onClick={() => setClassificationMode('api')}><strong>外部 API</strong><small>手动运行 · 可能计费</small></button>
          </div>
          <div className="classifier-subsection"><strong>本地模型配置</strong><small>模型和运行环境不随安装包提供，也不提供通用聊天。</small></div>
          <div className="local-ai-downloads">
            <button onClick={() => void window.biofrontier.classifier.openOfficialPage('model')}>打开 Qwen 官方模型页 ↗</button>
            <button onClick={() => void window.biofrontier.classifier.openOfficialPage('runtime')}>打开 llama.cpp 官方发布页 ↗</button>
          </div>
          <div className="local-ai-paths">
            <div><span><strong>GGUF 模型</strong><small title={classifierStatus?.modelPath}>{classifierStatus?.modelPath || '尚未选择'}</small></span><button onClick={() => void chooseLocalModel()}>选择模型</button></div>
            <div><span><strong>运行环境</strong><small title={classifierStatus?.runtimePath}>{classifierStatus?.runtimePath || '尚未选择 llama-server.exe'}</small></span><button onClick={() => void chooseLocalRuntime()}>选择程序</button></div>
          </div>
          <p>推荐与你的8GB显存匹配的 Qwen3 8B GGUF 量化模型。Windows GPU 版 llama.cpp 的 DLL 请与 llama-server.exe 保持在原发布包目录中；下载内容受各自许可证约束。</p>
          {classifierStatus?.configurationIssue && <p className="classifier-error">{classifierStatus.configurationIssue}</p>}
          {classifierStatus?.installed ? (
            <>
              <div className="classifier-options">
                <label><input type="checkbox" checked={localAuto} onChange={(event) => setLocalAuto(event.target.checked)} disabled={classificationMode !== 'local'} /> 使用本地 AI 时，同步后自动在后台分类</label>
                <label><input type="checkbox" checked={localPersistent} onChange={(event) => setLocalPersistent(event.target.checked)} disabled={classificationMode !== 'local'} /> 持续分类直到完成（中断后自动恢复）</label>
              </div>
              <div className="classifier-progress">
                <div>
                  <strong>{classifierStatus.modelName}</strong>
                  {classifierStatus.currentTitle && <small title={classifierStatus.currentTitle}>当前：{classifierStatus.currentTitle}</small>}
                </div>
                <span>{classifierStatus.busy ? `正在分类 ${classifierStatus.processed}/${classifierStatus.total}` : classifierStatus.total ? `待分类 ${classifierStatus.total} 条` : '当前没有待分类内容'}{classifierStatus.failed ? ` · 失败 ${classifierStatus.failed}` : ''}{classifierStatus.restarts ? ` · 自动恢复 ${classifierStatus.restarts} 次` : ''}</span>
              </div>
              {classifierStatus.lastError && <p className="classifier-error">{classifierStatus.lastError}</p>}
              <div className="classifier-actions">
                <button onClick={() => void testLocalAi()} disabled={classifierWorking || classifierStatus.busy}>{classifierWorking ? '正在测试…' : '测试本地 AI'}</button>
                <button onClick={() => void runClassifier()} disabled={classifierWorking || classifierStatus.busy || classifierStatus.total === 0}>{classifierWorking || classifierStatus.busy ? '正在分类…' : '开始本地分类'}</button>
                {(classifierStatus.running || classifierStatus.busy) && <button onClick={() => void stopClassifier()}>暂停并释放显存</button>}
                <button className="danger-quiet" onClick={() => void clearLocalAi()} disabled={classifierStatus.busy}>清除配置</button>
              </div>
            </>
          ) : <p>未配置本地 AI 时，文章仍可同步、收藏、保存、筛选，并使用基础关键词分类；外部 AI 功能也不受影响。</p>}
          <div className="classifier-subsection"><strong>外部 API 分类</strong><small>使用当前保存的 {AI_PROVIDER_LABELS[initial.aiProvider]} · {initial.aiModel}</small></div>
          <div className="classifier-progress api-classifier-progress">
            <div><strong>{apiClassifierStatus?.configured ? `${AI_PROVIDER_LABELS[apiClassifierStatus.provider]} API` : '尚未配置外部 API'}</strong>{apiClassifierStatus?.currentTitle && <small title={apiClassifierStatus.currentTitle}>当前：{apiClassifierStatus.currentTitle}</small>}</div>
            <span>{apiClassifierStatus?.busy ? `正在分类 ${apiClassifierStatus.processed}/${apiClassifierStatus.total}` : apiClassifierStatus?.total ? `待分类 ${apiClassifierStatus.total} 条` : '当前没有待分类内容'}{apiClassifierStatus?.failed ? ` · 失败 ${apiClassifierStatus.failed}` : ''}</span>
          </div>
          {apiClassifierStatus?.lastError && <p className="classifier-error">{apiClassifierStatus.lastError}</p>}
          <p>点击开始后，待分类论文的标题、摘要、来源分类和关注方向会分批发送给服务商。服务商可能按 Token 计费，可随时停止。</p>
          <div className="classifier-actions">
            <button onClick={() => void runApiClassifier()} disabled={classifierWorking || apiClassifierStatus?.busy || !apiClassifierStatus?.configured || !apiClassifierStatus?.total}>{apiClassifierStatus?.busy ? '正在 API 分类…' : '开始 API 分类'}</button>
            {apiClassifierStatus?.busy && <button onClick={() => void stopApiClassifier()}>停止 API 分类</button>}
          </div>
        </div>
      </section>
      <div className="settings-footer"><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? '正在保存…' : '保存设置'}</button></div>
    </>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><div>∿</div><p>{text}</p></div>
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function filterArticles(classified: Array<{ article: Article; insight: ArticleInsight }>, tab: Tab, search: string, filters: Filters): Array<{ article: Article; insight: ArticleInsight }> {
  const normalized = search.trim().toLowerCase()
  const cutoff = filters.time === 'all' ? null : Date.now() - Number(filters.time) * 24 * 60 * 60 * 1000
  return classified.filter(({ article, insight }) => {
    if (tab === 'favorites' && !article.isBookmarked) return false
    if (normalized && !`${article.title} ${article.abstract} ${article.authors} ${article.category || ''}`.toLowerCase().includes(normalized)) return false
    if (filters.status === 'unread' && article.isRead) return false
    if (filters.status === 'read' && !article.isRead) return false
    if (filters.status === 'bookmarked' && !article.isBookmarked) return false
    if (filters.classificationStatus !== 'all' && classificationStatus(article) !== filters.classificationStatus) return false
    if (filters.source !== 'all' && article.source !== filters.source) return false
    if (filters.type === 'preprint' && !article.isPreprint) return false
    if (filters.type === 'journal' && article.isPreprint) return false
    if (filters.relevance !== 'all' && insight.relevance !== filters.relevance) return false
    if (filters.primary.length && !filters.primary.includes(insight.primaryCategory)) return false
    if (filters.secondary.length && !filters.secondary.includes(insight.secondaryCategory)) return false
    if (cutoff) {
      const date = validTime(article.publishedAt)
      if (!date || date.getTime() < cutoff) return false
    }
    return true
  })
}

function classificationStatus(article: Article): Exclude<ClassificationStatusFilter, 'all'> {
  if (article.classificationFailure) return 'failed'
  const current = article.classification?.taxonomyVersion === TAXONOMY_VERSION
    && validPrimary(article.classification.primaryCategory)
    && validSecondary(article.classification.primaryCategory, article.classification.secondaryCategory)
  if (current && article.classification?.primaryCategory === '待确认') {
    return article.classification.secondaryCategory === '摘要信息不足' ? 'insufficient' : 'uncertain'
  }
  if (current) return 'classified'
  if (article.abstract.trim().length < 40) return 'insufficient'
  return 'unclassified'
}

function countActiveFilters(filters: Filters): number {
  return [filters.status, filters.classificationStatus, filters.relevance, filters.type, filters.time, filters.source].filter((value) => value !== 'all').length
    + (filters.primary.length ? 1 : 0)
    + (filters.secondary.length ? 1 : 0)
}

function filterChips(filters: Filters): FilterChip[] {
  const labels: Partial<Record<keyof Filters, Record<string, string>>> = {
    status: { unread: '未读', read: '已读', bookmarked: '已收藏' },
    classificationStatus: Object.fromEntries(CLASSIFICATION_STATUS_OPTIONS.map((option) => [option.value, option.label])),
    relevance: { high: '高度相关', possible: '可能相关', other: '低相关/未匹配' },
    type: { journal: '正式论文/网页', preprint: '预印本' },
    time: { '1': '最近 24 小时', '3': '最近 3 天', '7': '最近 7 天', '14': '最近 14 天', '30': '最近 30 天' }
  }
  const chips: FilterChip[] = []
  for (const kind of ['status', 'classificationStatus', 'relevance', 'type', 'time'] as const) {
    const value = filters[kind]
    if (value !== 'all') chips.push({ kind, value, label: labels[kind]?.[value] || value })
  }
  if (filters.source !== 'all') chips.push({ kind: 'source', value: filters.source, label: `来源：${filters.source}` })
  filters.primary.forEach((value) => chips.push({ kind: 'primary', value, label: value }))
  filters.secondary.forEach((value) => chips.push({ kind: 'secondary', value, label: value }))
  return chips
}

function removeChip(filters: Filters, chip: FilterChip): Filters {
  if (chip.kind === 'primary') {
    const primary = filters.primary.filter((value) => value !== chip.value)
    const allowedSecondary = new Set(primary.flatMap((value) => [...secondaryCategories(value)]))
    return { ...filters, primary, secondary: filters.secondary.filter((value) => allowedSecondary.has(value)) }
  }
  if (chip.kind === 'secondary') return { ...filters, secondary: filters.secondary.filter((value) => value !== chip.value) }
  return { ...filters, [chip.kind]: 'all' }
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function copyFilters(filters: Filters): Filters {
  return { ...filters, primary: [...filters.primary], secondary: [...filters.secondary] }
}

function articleDateLabel(article: Article): string {
  const published = validTime(article.publishedAt)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)
  if (published && published.getTime() > todayEnd.getTime()) {
    return `已在线收录 · 预定卷期 ${formatDate(article.publishedAt)}`
  }
  const prefix = article.isPreprint ? '发布' : '在线发表'
  const issue = article.issueDate && article.issueDate !== article.publishedAt ? ` · 卷期 ${formatDate(article.issueDate)}` : ''
  return `${prefix} ${formatDate(article.publishedAt)}${issue}`
}

function validTime(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function classifyArticle(article: Article, personalTopics: string[], classificationMode: ClassificationMode): ArticleInsight {
  if (classificationMode !== 'rules'
    && article.classification?.taxonomyVersion === TAXONOMY_VERSION
    && (classificationMode === 'api' ? article.classification.engine === 'api' : article.classification.engine !== 'api')
    && validPrimary(article.classification.primaryCategory)
    && validSecondary(article.classification.primaryCategory, article.classification.secondaryCategory)) {
    return {
      primaryCategory: article.classification.primaryCategory,
      secondaryCategory: article.classification.secondaryCategory,
      relatedTags: article.classification.relatedTags,
      relevance: article.classification.relevance,
      isAi: true,
      aiLabel: article.classification.engine === 'api'
        ? `${AI_PROVIDER_LABELS[apiProviderFromVersion(article.classification.modelVersion)]} API`
        : article.classification.engine === 'local-8b' ? '本地 8B' : '本地 4B'
    }
  }
  const title = article.title.toLowerCase()
  const abstract = article.abstract.toLowerCase()
  const category = (article.category || '').toLowerCase()
  const ranked = FALLBACK_RULES
    .map((rule) => ({
      ...rule,
      score: rule.keywords.reduce((score, keyword) => score
        + (containsKeyword(title, keyword) ? 3 : 0)
        + (containsKeyword(category, keyword) ? 2 : 0)
        + (containsKeyword(abstract, keyword) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]?.score >= 2 ? ranked[0] : null
  const relatedTags = ranked
    .filter((item) => item.score >= 2 && item.secondary !== best?.secondary)
    .map((item) => item.secondary)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 2)

  const personalTerms = [...new Set(personalTopics.flatMap(topicTerms))]
  const score = personalTerms.reduce((total, term) => total
    + (title.includes(term) ? 3 : 0)
    + (category.includes(term) ? 2 : 0)
    + (abstract.includes(term) ? 1 : 0), 0)
  const relevance: Relevance = score >= 3 ? 'high' : score >= 1 ? 'possible' : 'other'
  return {
    primaryCategory: best?.primary || '待确认',
    secondaryCategory: best?.secondary || (article.abstract.trim().length < 40 ? '摘要信息不足' : '跨领域待确认'),
    relatedTags,
    relevance,
    isAi: false
  }
}

function apiProviderFromVersion(modelVersion: string): AiProvider {
  const provider = modelVersion.split(':')[1]
  return provider === 'openai' || provider === 'anthropic' ? provider : 'deepseek'
}

function topicTerms(topic: string): string[] {
  const normalized = topic.toLowerCase().trim()
  if (!normalized) return []
  const ignored = new Set(['biology', 'biological', 'research', 'science', 'study', '生物学', '研究'])
  const tokens = normalized.match(/[a-z0-9-]{3,}|[\u3400-\u9fff]{2,}/g) || []
  return [normalized, ...tokens].filter((term) => !ignored.has(term))
}

function containsKeyword(text: string, keyword: string): boolean {
  if (/[^\x00-\x7f]/.test(keyword)) return text.includes(keyword)
  const prefix = keyword.endsWith('*')
  const value = prefix ? keyword.slice(0, -1) : keyword
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(prefix ? `(?:^|[^a-z0-9])${escaped}` : `(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function builtInDescription(id: string): string {
  if (id === 'pubmed') return '通过 Europe PMC 接口检索，原始链接跳转 PubMed'
  if (id === 'biorxiv') return '生命科学预印本官方接口'
  if (id === 'medrxiv') return '医学预印本官方接口'
  if (id === 'arxiv-qbio') return 'arXiv 定量生物学预印本官方接口'
  return '内置内容来源'
}

function defaultAiModel(provider: AiProvider): string {
  if (provider === 'openai') return 'gpt-5-mini'
  if (provider === 'anthropic') return 'claude-sonnet-4-5'
  return 'deepseek-v4-flash'
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
