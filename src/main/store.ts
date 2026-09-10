import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { AiProvider, Article, ArticleClassification, ClassificationMode, ContentSource, ResearchReport, Settings, SyncFrequency } from '../shared/types'

type ArticleInput = Omit<Article, 'isRead' | 'isBookmarked' | 'downloadPath' | 'summary'>

const DEFAULT_TOPICS = ['cell biology', 'genetics', 'immunology', 'neuroscience', 'cancer biology']

export class Store {
  private db: DatabaseSync

  constructor(path: string, defaultLibraryPath: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '',
        abstract TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL,
        issue_date TEXT,
        discovered_at TEXT NOT NULL,
        url TEXT NOT NULL,
        pdf_url TEXT,
        doi TEXT,
        category TEXT,
        is_preprint INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_articles_doi ON articles(doi);
      CREATE TABLE IF NOT EXISTS bookmarks (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        download_path TEXT,
        summary TEXT
      );
      CREATE TABLE IF NOT EXISTS article_state (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        read_at TEXT
      );
      CREATE TABLE IF NOT EXISTS article_classifications (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        primary_category TEXT NOT NULL,
        secondary_category TEXT NOT NULL DEFAULT '',
        secondary_categories TEXT NOT NULL,
        relevance TEXT NOT NULL,
        confidence REAL NOT NULL,
        basis TEXT NOT NULL,
        engine TEXT NOT NULL,
        model_version TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        taxonomy_version TEXT NOT NULL DEFAULT 'legacy'
      );
      CREATE TABLE IF NOT EXISTS article_classification_failures (
        article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
        error TEXT NOT NULL,
        failed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        frequency TEXT NOT NULL DEFAULT 'manual',
        last_synced_at TEXT,
        last_error TEXT,
        removable INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_reports (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        days INTEGER NOT NULL,
        partial INTEGER NOT NULL DEFAULT 0,
        report_json TEXT NOT NULL
      );
    `)
    const articleColumns = this.db.prepare('PRAGMA table_info(articles)').all() as Array<{ name: string }>
    if (!articleColumns.some((column) => column.name === 'issue_date')) {
      this.db.exec('ALTER TABLE articles ADD COLUMN issue_date TEXT')
    }
    const classificationColumns = this.db.prepare('PRAGMA table_info(article_classifications)').all() as Array<{ name: string }>
    if (!classificationColumns.some((column) => column.name === 'secondary_category')) {
      this.db.exec("ALTER TABLE article_classifications ADD COLUMN secondary_category TEXT NOT NULL DEFAULT ''")
    }
    if (!classificationColumns.some((column) => column.name === 'taxonomy_version')) {
      this.db.exec("ALTER TABLE article_classifications ADD COLUMN taxonomy_version TEXT NOT NULL DEFAULT 'legacy'")
    }
    const seedSource = this.db.prepare(`
      INSERT INTO content_sources (id, name, kind, url, enabled, frequency, removable, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    const createdAt = new Date().toISOString()
    seedSource.run('pubmed', 'PubMed', 'builtin', null, 1, 'startup', 0, createdAt)
    seedSource.run('biorxiv', 'bioRxiv', 'builtin', null, 1, 'startup', 0, createdAt)
    seedSource.run('medrxiv', 'medRxiv', 'builtin', null, 1, 'startup', 0, createdAt)
    seedSource.run('arxiv-qbio', 'arXiv q-bio', 'builtin', null, 0, 'startup', 0, createdAt)
    seedSource.run('journal:nature', 'Nature Portfolio 生物科学', 'rss', 'https://www.nature.com/subjects/biological-sciences.rss', 0, 'startup', 0, createdAt)
    seedSource.run('journal:plos-biology', 'PLOS Biology', 'rss', 'https://journals.plos.org/plosbiology/feed/atom', 0, 'startup', 0, createdAt)
    seedSource.run('journal:elife', 'eLife', 'rss', 'https://elifesciences.org/rss/recent.xml', 0, 'startup', 0, createdAt)
    this.db.prepare(`
      UPDATE content_sources
      SET name = 'Nature Portfolio 生物科学',
          url = 'https://www.nature.com/subjects/biological-sciences.rss',
          last_error = NULL
      WHERE id = 'journal:nature' AND url = 'https://www.nature.com/nature.rss'
    `).run()
    if (!this.getSetting('topics')) this.setSetting('topics', JSON.stringify(DEFAULT_TOPICS))
    if (!this.getSetting('browser')) this.setSetting('browser', 'chrome')
    if (!this.getSetting('libraryPath')) this.setSetting('libraryPath', defaultLibraryPath)
    if (!this.getSetting('deepseekModel')) this.setSetting('deepseekModel', 'deepseek-v4-flash')
    if (!this.getSetting('aiProvider')) this.setSetting('aiProvider', 'deepseek')
    if (!this.getSetting('aiModel')) this.setSetting('aiModel', this.getSetting('deepseekModel') || 'deepseek-v4-flash')
    if (!this.getSetting('syncDaysFrontierV2')) {
      this.setSetting('syncDays', '7')
      this.setSetting('syncDaysFrontierV2', 'true')
    }
    if (!this.getSetting('syncDays')) this.setSetting('syncDays', '7')
    if (!this.getSetting('profileNickname')) this.setSetting('profileNickname', '研究者')
    if (!this.getSetting('profileTagline')) this.setSetting('profileTagline', '我的生物前沿')
    if (!this.getSetting('localClassifierEnabled')) this.setSetting('localClassifierEnabled', 'false')
    if (!this.getSetting('classificationMode')) this.setSetting('classificationMode', this.getSetting('localClassifierEnabled') === 'true' ? 'local' : 'rules')
    if (!this.getSetting('localClassifierAuto')) this.setSetting('localClassifierAuto', 'true')
    if (!this.getSetting('localClassifierPersistent')) this.setSetting('localClassifierPersistent', 'true')
    if (!this.getSetting('allowPrivateSources')) this.setSetting('allowPrivateSources', 'false')
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  saveResearchReport(report: ResearchReport): void {
    this.db.prepare(`
      INSERT INTO research_reports (id, query, created_at, completed_at, days, partial, report_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET completed_at = excluded.completed_at, partial = excluded.partial, report_json = excluded.report_json
    `).run(report.id, report.query, report.createdAt, report.completedAt, report.days, report.partial ? 1 : 0, JSON.stringify(report))
  }

  listResearchReports(): ResearchReport[] {
    const rows = this.db.prepare('SELECT report_json FROM research_reports ORDER BY completed_at DESC LIMIT 30').all() as Array<{ report_json: string }>
    return rows.flatMap((row) => {
      try { return [JSON.parse(row.report_json) as ResearchReport] } catch { return [] }
    })
  }

  getSettings(configuredProviders: AiProvider[] = []): Settings {
    let topics = DEFAULT_TOPICS
    try {
      topics = JSON.parse(this.getSetting('topics') || '[]')
    } catch {
      topics = DEFAULT_TOPICS
    }
    const aiProvider = (['deepseek', 'openai', 'anthropic'].includes(this.getSetting('aiProvider') || '') ? this.getSetting('aiProvider') : 'deepseek') as AiProvider
    const aiModel = this.getSetting('aiModel') || this.getSetting('deepseekModel') || 'deepseek-v4-flash'
    const storedClassificationMode = this.getSetting('classificationMode')
    const classificationMode: ClassificationMode = ['rules', 'local', 'api'].includes(storedClassificationMode || '')
      ? storedClassificationMode as ClassificationMode
      : this.getSetting('localClassifierEnabled') === 'true' ? 'local' : 'rules'
    return {
      topics,
      browser: this.getSetting('browser') === 'default' ? 'default' : 'chrome',
      libraryPath: this.getSetting('libraryPath') || '',
      deepseekModel: this.getSetting('deepseekModel') || 'deepseek-v4-flash',
      aiProvider,
      aiModel,
      configuredProviders,
      hasApiKey: configuredProviders.includes(aiProvider),
      syncDays: Number(this.getSetting('syncDays') || 7),
      classificationMode,
      localClassifierEnabled: classificationMode !== 'rules',
      localClassifierAuto: this.getSetting('localClassifierAuto') !== 'false',
      localClassifierPersistent: this.getSetting('localClassifierPersistent') !== 'false',
      allowPrivateSources: this.getSetting('allowPrivateSources') === 'true'
    }
  }

  saveSettings(settings: Partial<Omit<Settings, 'hasApiKey'>>): void {
    if (settings.topics) this.setSetting('topics', JSON.stringify(settings.topics))
    if (settings.browser) this.setSetting('browser', settings.browser)
    if (settings.libraryPath) this.setSetting('libraryPath', settings.libraryPath)
    if (settings.deepseekModel) this.setSetting('deepseekModel', settings.deepseekModel)
    if (settings.aiProvider) this.setSetting('aiProvider', settings.aiProvider)
    if (settings.aiModel) {
      this.setSetting('aiModel', settings.aiModel)
      if ((settings.aiProvider || this.getSetting('aiProvider')) === 'deepseek') this.setSetting('deepseekModel', settings.aiModel)
    }
    if (settings.syncDays) this.setSetting('syncDays', String(settings.syncDays))
    if (settings.classificationMode) {
      this.setSetting('classificationMode', settings.classificationMode)
      this.setSetting('localClassifierEnabled', String(settings.classificationMode !== 'rules'))
    } else if (settings.localClassifierEnabled !== undefined) {
      this.setSetting('localClassifierEnabled', String(settings.localClassifierEnabled))
      this.setSetting('classificationMode', settings.localClassifierEnabled ? 'local' : 'rules')
    }
    if (settings.localClassifierAuto !== undefined) this.setSetting('localClassifierAuto', String(settings.localClassifierAuto))
    if (settings.localClassifierPersistent !== undefined) this.setSetting('localClassifierPersistent', String(settings.localClassifierPersistent))
    if (settings.allowPrivateSources !== undefined) this.setSetting('allowPrivateSources', String(settings.allowPrivateSources))
  }

  listSources(): ContentSource[] {
    const rows = this.db.prepare(`
      SELECT * FROM content_sources
      ORDER BY CASE kind WHEN 'builtin' THEN 0 ELSE 1 END, created_at, name
    `).all() as Record<string, unknown>[]
    return rows.map(mapSource)
  }

  getSource(id: string): ContentSource | undefined {
    const row = this.db.prepare('SELECT * FROM content_sources WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapSource(row) : undefined
  }

  addRssSource(input: { name: string; url: string; frequency: SyncFrequency }): ContentSource[] {
    const id = `rss:${randomUUID()}`
    this.db.prepare(`
      INSERT INTO content_sources (id, name, kind, url, enabled, frequency, removable, created_at)
      VALUES (?, ?, 'rss', ?, 1, ?, 1, ?)
    `).run(id, input.name, input.url, input.frequency, new Date().toISOString())
    return this.listSources()
  }

  updateSource(id: string, changes: { enabled?: boolean; frequency?: SyncFrequency; name?: string }): ContentSource[] {
    const current = this.getSource(id)
    if (!current) throw new Error('没有找到这个来源。')
    const name = changes.name?.trim() || current.name
    const enabled = changes.enabled === undefined ? current.enabled : changes.enabled
    const frequency = changes.frequency || current.frequency
    this.db.prepare('UPDATE content_sources SET name = ?, enabled = ?, frequency = ? WHERE id = ?')
      .run(name, enabled ? 1 : 0, frequency, id)
    return this.listSources()
  }

  removeSource(id: string): ContentSource[] {
    const current = this.getSource(id)
    if (!current) return this.listSources()
    if (!current.removable) throw new Error('内置来源不能删除，但可以关闭。')
    this.db.prepare('DELETE FROM content_sources WHERE id = ?').run(id)
    return this.listSources()
  }

  updateSourceStatus(id: string, syncedAt: string | null, error: string | null): void {
    this.db.prepare(`
      UPDATE content_sources
      SET last_synced_at = COALESCE(?, last_synced_at), last_error = ?
      WHERE id = ?
    `).run(syncedAt, error, id)
  }

  upsertArticles(items: ArticleInput[]): { added: number; updated: number } {
    const exists = this.db.prepare('SELECT 1 FROM articles WHERE id = ?')
    const byDoi = this.db.prepare("SELECT id, url, pdf_url FROM articles WHERE doi IS NOT NULL AND lower(doi) = lower(?) LIMIT 1")
    const write = this.db.prepare(`
      INSERT INTO articles (
        id, source, title, authors, abstract, published_at, discovered_at,
        issue_date, url, pdf_url, doi, category, is_preprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        abstract = CASE WHEN excluded.abstract <> '' THEN excluded.abstract ELSE articles.abstract END,
        published_at = excluded.published_at,
        issue_date = COALESCE(excluded.issue_date, articles.issue_date),
        url = excluded.url,
        pdf_url = COALESCE(excluded.pdf_url, articles.pdf_url),
        doi = COALESCE(excluded.doi, articles.doi),
        category = COALESCE(excluded.category, articles.category)
    `)
    let added = 0
    let updated = 0
    this.db.exec('BEGIN')
    try {
      for (const item of items) {
        const duplicate = item.doi ? byDoi.get(normalizeDoi(item.doi)) as { id: string; url: string; pdf_url?: string } | undefined : undefined
        const target = duplicate ? { ...item, id: duplicate.id, url: duplicate.url, pdfUrl: duplicate.pdf_url || item.pdfUrl, doi: normalizeDoi(item.doi || '') } : { ...item, doi: item.doi ? normalizeDoi(item.doi) : undefined }
        if (exists.get(target.id)) updated += 1
        else added += 1
        write.run(
          target.id,
          target.source,
          target.title,
          target.authors,
          target.abstract,
          target.publishedAt,
          target.discoveredAt,
          target.issueDate || null,
          target.url,
          target.pdfUrl || null,
          target.doi || null,
          target.category || null,
          target.isPreprint ? 1 : 0
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { added, updated }
  }

  listArticles(filter: { bookmarked?: boolean; search?: string } = {}): Article[] {
    const clauses: string[] = []
    const params: string[] = []
    if (filter.bookmarked) clauses.push('b.article_id IS NOT NULL')
    if (filter.search?.trim()) {
      clauses.push('(a.title LIKE ? OR a.abstract LIKE ? OR a.authors LIKE ? OR a.category LIKE ?)')
      const term = `%${filter.search.trim()}%`
      params.push(term, term, term, term)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`
      SELECT a.*, b.article_id AS bookmarked_id, b.download_path, b.summary, s.read_at,
        c.primary_category, c.secondary_category, c.secondary_categories, c.relevance AS classification_relevance,
        c.confidence, c.basis, c.engine, c.model_version, c.classified_at, c.input_hash, c.taxonomy_version,
        f.error AS classification_failure, f.failed_at AS classification_failed_at
      FROM articles a
      LEFT JOIN bookmarks b ON b.article_id = a.id
      LEFT JOIN article_state s ON s.article_id = a.id
      LEFT JOIN article_classifications c ON c.article_id = a.id
      LEFT JOIN article_classification_failures f ON f.article_id = a.id
      ${where}
      ORDER BY
        CASE WHEN date(a.published_at) > date('now') THEN date(a.discovered_at) ELSE date(a.published_at) END DESC,
        a.discovered_at DESC
      LIMIT 500
    `).all(...params) as Record<string, unknown>[]
    return rows.map(mapArticle)
  }

  getArticle(id: string): Article | undefined {
    const row = this.db.prepare(`
      SELECT a.*, b.article_id AS bookmarked_id, b.download_path, b.summary, s.read_at,
        c.primary_category, c.secondary_category, c.secondary_categories, c.relevance AS classification_relevance,
        c.confidence, c.basis, c.engine, c.model_version, c.classified_at, c.input_hash, c.taxonomy_version,
        f.error AS classification_failure, f.failed_at AS classification_failed_at
      FROM articles a
      LEFT JOIN bookmarks b ON b.article_id = a.id
      LEFT JOIN article_state s ON s.article_id = a.id
      LEFT JOIN article_classifications c ON c.article_id = a.id
      LEFT JOIN article_classification_failures f ON f.article_id = a.id
      WHERE a.id = ?
    `).get(id) as Record<string, unknown> | undefined
    return row ? mapArticle(row) : undefined
  }

  setBookmark(id: string, value: boolean): void {
    if (value) {
      this.db.prepare(`
        INSERT INTO bookmarks (article_id, created_at) VALUES (?, ?)
        ON CONFLICT(article_id) DO NOTHING
      `).run(id, new Date().toISOString())
    } else {
      this.db.prepare('DELETE FROM bookmarks WHERE article_id = ?').run(id)
    }
  }

  setRead(id: string, value: boolean): void {
    if (value) {
      this.db.prepare(`
        INSERT INTO article_state (article_id, read_at) VALUES (?, ?)
        ON CONFLICT(article_id) DO UPDATE SET read_at = excluded.read_at
      `).run(id, new Date().toISOString())
    } else {
      this.db.prepare('DELETE FROM article_state WHERE article_id = ?').run(id)
    }
  }

  setDownloadPath(id: string, path: string): void {
    this.setBookmark(id, true)
    this.db.prepare('UPDATE bookmarks SET download_path = ? WHERE article_id = ?').run(path, id)
  }

  setSummary(id: string, summary: string): void {
    this.setBookmark(id, true)
    this.db.prepare('UPDATE bookmarks SET summary = ? WHERE article_id = ?').run(summary, id)
  }

  setClassification(id: string, classification: ArticleClassification): void {
    this.db.prepare(`
      INSERT INTO article_classifications (
        article_id, primary_category, secondary_category, secondary_categories, relevance, confidence,
        basis, engine, model_version, classified_at, input_hash, taxonomy_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET
        primary_category = excluded.primary_category,
        secondary_category = excluded.secondary_category,
        secondary_categories = excluded.secondary_categories,
        relevance = excluded.relevance,
        confidence = excluded.confidence,
        basis = excluded.basis,
        engine = excluded.engine,
        model_version = excluded.model_version,
        classified_at = excluded.classified_at,
        input_hash = excluded.input_hash,
        taxonomy_version = excluded.taxonomy_version
    `).run(
      id,
      classification.primaryCategory,
      classification.secondaryCategory,
      JSON.stringify(classification.relatedTags),
      classification.relevance,
      classification.confidence,
      JSON.stringify(classification.basis),
      classification.engine,
      classification.modelVersion,
      classification.classifiedAt,
      classification.inputHash,
      classification.taxonomyVersion
    )
    this.db.prepare('DELETE FROM article_classification_failures WHERE article_id = ?').run(id)
  }

  setClassificationFailure(id: string, error: string): void {
    this.db.prepare(`
      INSERT INTO article_classification_failures (article_id, error, failed_at) VALUES (?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET error = excluded.error, failed_at = excluded.failed_at
    `).run(id, error.slice(0, 1000), new Date().toISOString())
  }
}

function mapArticle(row: Record<string, unknown>): Article {
  return {
    id: String(row.id),
    source: row.source as Article['source'],
    title: String(row.title),
    authors: String(row.authors || ''),
    abstract: String(row.abstract || ''),
    publishedAt: String(row.published_at),
    issueDate: row.issue_date ? String(row.issue_date) : undefined,
    discoveredAt: String(row.discovered_at),
    url: String(row.url),
    pdfUrl: row.pdf_url ? String(row.pdf_url) : undefined,
    doi: row.doi ? String(row.doi) : undefined,
    category: row.category ? String(row.category) : undefined,
    isPreprint: Boolean(row.is_preprint),
    isRead: Boolean(row.read_at),
    isBookmarked: Boolean(row.bookmarked_id),
    downloadPath: row.download_path ? String(row.download_path) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
    classificationFailure: row.classification_failure ? String(row.classification_failure) : undefined,
    classificationFailedAt: row.classification_failed_at ? String(row.classification_failed_at) : undefined,
    classification: row.primary_category ? {
      primaryCategory: String(row.primary_category),
      secondaryCategory: String(row.secondary_category || ''),
      relatedTags: parseStringArray(row.secondary_categories),
      relevance: ['high', 'possible'].includes(String(row.classification_relevance)) ? String(row.classification_relevance) as 'high' | 'possible' : 'other',
      confidence: Number(row.confidence || 0),
      basis: parseStringArray(row.basis),
      engine: row.engine === 'api' ? 'api' : row.engine === 'local-8b' ? 'local-8b' : 'local-4b',
      modelVersion: String(row.model_version || ''),
      classifiedAt: String(row.classified_at || ''),
      inputHash: String(row.input_hash || ''),
      taxonomyVersion: String(row.taxonomy_version || 'legacy')
    } : undefined
  }
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function normalizeDoi(value: string): string {
  return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase()
}

function mapSource(row: Record<string, unknown>): ContentSource {
  const frequency = String(row.frequency) as SyncFrequency
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind === 'rss' ? 'rss' : 'builtin',
    url: row.url ? String(row.url) : undefined,
    enabled: Boolean(row.enabled),
    frequency: ['manual', 'startup', 'daily'].includes(frequency) ? frequency : 'manual',
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    removable: Boolean(row.removable)
  }
}
