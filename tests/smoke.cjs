const { _electron: electron } = require('playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { DatabaseSync } = require('node:sqlite')

async function main() {
  const root = path.resolve(__dirname, '..')
  const artifacts = path.join(root, '.test-artifacts')
  fs.mkdirSync(artifacts, { recursive: true })
  const testServer = await startTestServer()
  seedLongContent(path.join(root, '.user-data', 'biofrontier.sqlite'))
  let app
  try {
    app = await electron.launch({
      executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [root, '--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(root, '.user-data')}`],
      env: {
        ...process.env,
        BIOFRONTIER_LIBRARY_PATH: path.join(root, '.test-library'),
        BIOFRONTIER_CLASSIFIER_FAKE: '1',
        BIOFRONTIER_CLASSIFIER_FAKE_FAIL_ONCE: '1',
        BIOFRONTIER_AI_FAKE: '1'
      },
      timeout: 30_000
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await acceptAgreementIfShown(page, artifacts)
    const title = await page.locator('h1').first().textContent()
    if (title !== '最新生物前沿') throw new Error(`Unexpected title: ${title}`)
    await page.locator('.ai-button').first().click()
    await page.getByRole('heading', { name: '发送给 DeepSeek 前请确认' }).waitFor()
    await page.getByLabel('记住我的选择，以后不再弹出此确认框').check()
    await page.screenshot({ path: path.join(artifacts, 'external-ai-consent.png'), fullPage: false })
    await page.getByRole('button', { name: '取消' }).click()
    await page.evaluate(async () => {
      await window.biofrontier.ai.revokeDisclosure('deepseek')
    })
    const oneTimeConsent = await page.evaluate(async () => {
      const article = (await window.biofrontier.articles.list()).find((item) => item.abstract)
      if (!article) return { first: 'no article', second: 'no article' }
      await window.biofrontier.ai.grantOnce('deepseek')
      let first = ''
      let second = ''
      try { await window.biofrontier.ai.summarize(article.id) } catch (error) { first = String(error) }
      try { await window.biofrontier.ai.summarize(article.id) } catch (error) { second = String(error) }
      return { first, second }
    })
    if (oneTimeConsent.first || !oneTimeConsent.second.includes('确认数据发送提示')) {
      throw new Error(`One-time AI consent was not consumed correctly: ${JSON.stringify(oneTimeConsent)}`)
    }
    await page.locator('.profile-card').click()
    await page.getByRole('heading', { name: '我的研究身份' }).waitFor()
    await page.getByLabel('昵称').fill('BioFrontier 测试用户')
    await page.getByLabel('个人说明').fill('本地资料 · 不联网')
    await page.getByRole('button', { name: '保存本地资料' }).click()
    await page.locator('.profile-card', { hasText: 'BioFrontier 测试用户' }).waitFor()
    const totalText = await page.locator('.toolbar-actions > span').textContent()
    const expectedTotal = Number(totalText?.match(/\/\s*(\d+)/)?.[1] || 0)
    const initialCards = await page.locator('.article-card').count()
    if (expectedTotal > 36 && initialCards > 36) throw new Error(`Long list rendered too eagerly: ${initialCards}/${expectedTotal}`)
    if (expectedTotal > 36) {
      const loadMore = page.getByRole('button', { name: /继续加载/ })
      await loadMore.click()
      await page.waitForFunction((before) => document.querySelectorAll('.article-card').length > before, initialCards)
    }
    await page.getByRole('button', { name: /^筛选/ }).click()
    const statusCounts = await page.locator('.status-choices button em').allTextContents()
    const statusTotal = statusCounts.reduce((sum, value) => sum + Number(value), 0)
    if (!expectedTotal || statusTotal !== expectedTotal) throw new Error(`Classification statuses overlap or omit records: ${statusTotal}/${expectedTotal}`)
    await page.getByRole('button', { name: '关闭筛选' }).click()
    await assertNoHorizontalOverflow(page, 'default window')
    await assertNoClippedContent(page, 'default window')
    await page.screenshot({ path: path.join(artifacts, 'layout-wide.png'), fullPage: false })
    await page.setViewportSize({ width: 900, height: 720 })
    await assertNoHorizontalOverflow(page, 'narrow window')
    await assertNoClippedContent(page, 'narrow window')
    await page.getByRole('button', { name: /^筛选/ }).click()
    await page.getByLabel('内容来源').selectOption('Filter Test Source')
    await page.getByLabel('遗传、组学与进化').check()
    await page.getByRole('button', { name: /基因组学/ }).click()
    await page.getByText('阅读状态、时间和类型', { exact: true }).click()
    await page.getByLabel('信息状态').selectOption('unread')
    await page.screenshot({ path: path.join(artifacts, 'filter-drawer.png'), fullPage: false })
    await page.getByRole('button', { name: /查看 \d+ 篇/ }).click()
    await page.getByRole('heading', { name: 'CRISPR genome editing identifies a genetic regulator of stem cells' }).waitFor()
    await page.getByRole('button', { name: '标为已读' }).click()
    await page.getByRole('button', { name: /^筛选/ }).click()
    await page.getByText('阅读状态、时间和类型', { exact: true }).click()
    await page.getByLabel('信息状态').selectOption('read')
    await page.getByRole('button', { name: /查看 \d+ 篇/ }).click()
    await page.getByRole('heading', { name: 'CRISPR genome editing identifies a genetic regulator of stem cells' }).waitFor()
    await page.screenshot({ path: path.join(artifacts, 'filters-page.png'), fullPage: false })
    await page.getByRole('button', { name: '清除全部' }).click()
    await page.locator('.article-card').first().waitFor({ timeout: 10_000 })
    const sourceCount = await page.locator('.source-badge').count()
    if (sourceCount === 0) throw new Error('No source-linked articles were rendered')
    const futureRecord = page.locator('.article-card').filter({ hasText: 'A very long biological research title' })
    await futureRecord.waitFor()
    const futureDateLabel = await futureRecord.locator('time').textContent()
    if (!futureDateLabel?.includes('预定卷期')) throw new Error(`Future issue date is ambiguous: ${futureDateLabel}`)

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByLabel('允许自定义来源访问本机或局域网').check()
    await page.getByRole('button', { name: '保存设置' }).click()
    await page.getByRole('button', { name: '来源管理' }).click()
    await page.getByRole('heading', { name: '来源管理' }).waitFor()
    for (const name of ['PubMed', 'bioRxiv', 'medRxiv', 'arXiv q-bio', 'Nature Portfolio 生物科学', 'PLOS Biology', 'eLife']) {
      await page.getByRole('heading', { name, exact: true }).waitFor()
    }
    const sourceName = `本地测试源-${Date.now()}`
    await page.getByLabel('来源名称').fill(sourceName)
    await page.getByLabel('RSS/Atom 地址').fill(`${testServer.url}/feed.xml`)
    await page.getByLabel('同步频率').selectOption('manual')
    await page.getByRole('button', { name: '添加并测试' }).click()
    await page.getByRole('heading', { name: sourceName }).waitFor({ timeout: 15_000 })
    const flakySourceName = `重试测试源-${Date.now()}`
    await page.getByLabel('来源名称').fill(flakySourceName)
    await page.getByLabel('RSS/Atom 地址').fill(`${testServer.url}/flaky-feed.xml`)
    await page.getByRole('button', { name: '添加并测试' }).click()
    await page.getByRole('heading', { name: flakySourceName }).waitFor({ timeout: 15_000 })
    if (testServer.flakyRequests !== 3) throw new Error(`Transient feed was not retried twice: ${testServer.flakyRequests}`)
    await page.screenshot({ path: path.join(artifacts, 'sources-page.png'), fullPage: true })
    await page.getByLabel('网页地址').fill(`${testServer.url}/article`)
    await page.getByRole('button', { name: '读取并收藏' }).click()
    await page.getByRole('button', { name: '我的收藏' }).click()
    await page.getByRole('heading', { name: '我的收藏' }).waitFor()
    await page.getByRole('heading', { name: '本地网页导入测试' }).first().waitFor()
    await assertNoHorizontalOverflow(page, 'custom sources and imports')

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('heading', { name: '设置' }).waitFor()
    const syncOptions = await page.getByLabel('前沿内容同步范围').locator('option').allTextContents()
    if (syncOptions.join('|') !== '最近 1 天|最近 3 天|最近 5 天|最近 7 天|最近 10 天|最近 14 天') throw new Error(`Unexpected sync ranges: ${syncOptions.join('|')}`)
    await page.getByLabel('前沿内容同步范围').selectOption('7')
    for (const provider of ['DeepSeek', 'OpenAI', 'Claude']) await page.getByRole('button', { name: new RegExp(`^${provider}`) }).waitFor()
    await page.getByRole('button', { name: /^Claude/ }).click()
    if (await page.getByLabel('模型 ID').inputValue() !== 'claude-sonnet-4-5') throw new Error('Claude default model was not selected')
    await page.getByRole('button', { name: /^DeepSeek/ }).click()
    await page.getByText('BioFrontier 测试8B分类器').waitFor()
    await page.getByRole('group', { name: '文章分类方式' }).getByRole('button', { name: /本地 AI/ }).click()
    await page.getByLabel('持续分类直到完成（中断后自动恢复）').check()
    const classifyButton = page.getByRole('button', { name: '开始本地分类' })
    if (await classifyButton.isEnabled()) await classifyButton.click()
    await page.getByText('当前没有待分类内容').waitFor({ timeout: 30_000 })
    await page.getByText(/自动恢复 1 次/).waitFor()
    await page.getByRole('button', { name: '保存设置' }).click()
    await page.getByRole('button', { name: '最新动态' }).click()
    await page.getByRole('button', { name: /^筛选/ }).click()
    await page.getByLabel('内容来源').selectOption('Filter Test Source')
    await page.getByRole('button', { name: /查看 \d+ 篇/ }).click()
    await page.locator('.local-model-badge', { hasText: '本地 8B' }).waitFor()
    await page.locator('.primary-category-badge', { hasText: '遗传、组学与进化' }).waitFor()
    await page.locator('.secondary-category-badge', { hasText: '基因组学' }).waitFor()
    await page.getByRole('button', { name: '清除全部' }).click()
    await page.getByRole('button', { name: 'AI 专题速报' }).click()
    await page.getByRole('heading', { name: 'AI 专题速报' }).waitFor()
    await page.getByLabel('这次要追踪什么研究问题？').fill('CRISPR基因编辑如何影响干细胞调控？')
    await page.getByLabel('专题搜集范围').selectOption('7')
    await page.getByRole('button', { name: '使用本地 AI 生成' }).click()
    await page.getByText('近期记录显示，基因编辑正被用于识别和验证干细胞调控机制。').waitFor({ timeout: 20_000 })
    await page.getByText(/查看全部 \d+ 个原始来源/).waitFor()
    await assertNoHorizontalOverflow(page, 'local research report')
    await page.screenshot({ path: path.join(artifacts, 'research-report.png'), fullPage: true })
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('group', { name: '文章分类方式' }).getByRole('button', { name: /外部 API/ }).click()
    const apiClassifyButton = page.getByRole('button', { name: '开始 API 分类' })
    if (!await apiClassifyButton.isEnabled()) throw new Error('API classification should be available for the seeded unclassified article')
    await apiClassifyButton.click()
    await page.getByRole('heading', { name: '发送给 DeepSeek 前请确认' }).waitFor()
    await page.getByLabel('记住我的选择，以后不再弹出此确认框').check()
    await page.getByRole('button', { name: '同意并记住' }).click()
    await page.getByText(/API 分类完成：/).waitFor({ timeout: 30_000 })
    const apiClassificationEngine = await page.evaluate(async () => (await window.biofrontier.articles.list()).find((item) => item.id === 'filter:genetics-source-test')?.classification?.engine)
    if (apiClassificationEngine !== 'api') throw new Error(`Unexpected API classification engine: ${apiClassificationEngine}`)
    await page.getByRole('button', { name: 'AI 专题速报' }).click()
    await page.getByRole('group', { name: '专题生成方式' }).getByRole('button', { name: /外部 API/ }).click()
    await page.getByLabel('这次要追踪什么研究问题？').fill('API模式下CRISPR研究有什么新进展？')
    await page.getByRole('button', { name: '使用 API 生成' }).click()
    await page.getByText('API 模式已根据公开摘要生成专题速报。').waitFor({ timeout: 20_000 })
    const apiReport = await page.evaluate(async () => (await window.biofrontier.research.reports()).find((item) => item.query === 'API模式下CRISPR研究有什么新进展？'))
    if (apiReport?.generatorType !== 'api' || !apiReport.generatorModel?.includes('DeepSeek API')) throw new Error(`Unexpected API report metadata: ${JSON.stringify(apiReport)}`)
    await assertNoHorizontalOverflow(page, 'api research report')
    await page.screenshot({ path: path.join(artifacts, 'api-research-report.png'), fullPage: true })
    await page.getByRole('button', { name: '设置' }).click()
    await page.screenshot({ path: path.join(artifacts, 'settings.png'), fullPage: true })
    console.log('Smoke test passed')
  } finally {
    if (app) await app.close()
    await testServer.close()
  }
}

async function acceptAgreementIfShown(page, artifacts) {
  const heading = page.getByRole('heading', { name: '欢迎使用 BioFrontier' })
  if (!await heading.isVisible().catch(() => false)) return
  await page.screenshot({ path: path.join(artifacts, 'agreement-gate.png'), fullPage: false })
  await page.getByRole('tab', { name: '隐私说明' }).click()
  await page.getByText('隐私说明', { exact: true }).first().waitFor()
  await page.getByLabel('我已阅读并同意《应用使用协议》和《隐私说明》').check()
  await page.getByRole('button', { name: '同意并进入应用' }).click()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

function seedLongContent(databasePath) {
  if (!fs.existsSync(databasePath)) return
  const db = new DatabaseSync(databasePath)
  const settingsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()
  if (settingsTable) {
    db.prepare("DELETE FROM settings WHERE key IN ('legalAcceptedVersion', 'legalAcceptedAt', 'aiDisclosureAccepted:deepseek')").run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('aiApiKey:deepseek', 'smoke-placeholder') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
  }
  const sourcesTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_sources'").get()
  if (sourcesTable) {
    db.prepare(`UPDATE content_sources SET name = 'Nature', url = 'https://www.nature.com/nature.rss', last_error = '旧地址错误'
      WHERE id = 'journal:nature'`).run()
  }
  const id = 'layout:long-content-test'
  db.prepare(`INSERT INTO articles (
    id, source, title, authors, abstract, published_at, discovered_at, url, is_preprint
  ) VALUES (?, 'PubMed', ?, ?, ?, '2099-01-01', '2099-01-01', 'https://pubmed.ncbi.nlm.nih.gov/', 0)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, abstract = excluded.abstract`).run(
    id,
    'A very long biological research title with Wnt/beta-catenin and BMP signaling ' + 'UnbrokenTargetName'.repeat(45),
    'Layout Test Author',
    'This abstract verifies responsive wrapping. '.repeat(100) + 'UnbrokenSequence'.repeat(80)
  )
  db.prepare(`INSERT INTO bookmarks (article_id, created_at, summary) VALUES (?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET summary = excluded.summary`).run(
    id,
    new Date().toISOString(),
    '基于摘要的长篇初步解读\n\n' + '这是一段用于验证中文和EnglishMixedContent能够正常换行的内容。'.repeat(140) + 'NoWhitespaceToken'.repeat(100)
  )
  const filterId = 'filter:genetics-source-test'
  const today = new Date().toISOString().slice(0, 10)
  db.prepare(`INSERT INTO articles (
    id, source, title, authors, abstract, published_at, discovered_at, url, category, is_preprint
  ) VALUES (?, 'Filter Test Source', ?, 'Filter Test Author', ?, ?, ?, 'https://example.org/filter-test', 'Genetics and genomics', 0)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, abstract = excluded.abstract,
    published_at = excluded.published_at, discovered_at = excluded.discovered_at`).run(
    filterId,
    'CRISPR genome editing identifies a genetic regulator of stem cells',
    'A focused genetics and genomics abstract for testing personalized information and source filters.',
    today,
    new Date().toISOString()
  )
  const stateTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'article_state'").get()
  if (stateTable) db.prepare('DELETE FROM article_state WHERE article_id = ?').run(filterId)
  const classificationTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'article_classifications'").get()
  if (classificationTable) db.prepare('DELETE FROM article_classifications WHERE article_id = ?').run(filterId)
  const insertPerformanceArticle = db.prepare(`INSERT INTO articles (
    id, source, title, authors, abstract, published_at, discovered_at, url, category, is_preprint
  ) VALUES (?, 'Performance Test', ?, 'Performance Test Author', ?, ?, ?, ?, 'Cell biology', 0)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, abstract = excluded.abstract,
    published_at = excluded.published_at, discovered_at = excluded.discovered_at`)
  for (let index = 0; index < 120; index += 1) {
    insertPerformanceArticle.run(
      `performance:list-${index}`,
      `Performance list article ${String(index + 1).padStart(3, '0')}`,
      'A compact cell biology abstract used to verify incremental rendering and smooth long-list scrolling.',
      today,
      new Date(Date.now() - index * 1000).toISOString(),
      `https://example.org/performance/${index}`
    )
  }
  db.close()
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth
  }))
  if (dimensions.documentWidth > dimensions.viewportWidth + 1 || dimensions.bodyWidth > dimensions.viewportWidth + 1) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(dimensions)}`)
  }
}

async function assertNoClippedContent(page, label) {
  const clipped = await page.evaluate(() => [...document.querySelectorAll('button, input, textarea, select, .article-card, .toolbar, .page-header')]
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 40), left: rect.left, right: rect.right }
    })
    .filter((item) => item.left < -1 || item.right > window.innerWidth + 1))
  if (clipped.length) throw new Error(`${label} has clipped controls: ${JSON.stringify(clipped.slice(0, 8))}`)
}

async function startTestServer() {
  let flakyRequests = 0
  const server = http.createServer((request, response) => {
    if (request.url === '/feed.xml') {
      response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><title>本地测试源</title>
        <item><guid>local-rss-entry</guid><title>本地 RSS 生物学测试文章</title>
        <link>http://127.0.0.1/article</link><description>用于验证用户添加的 RSS 来源可以被读取。</description>
        <pubDate>Sat, 30 Aug 2026 12:00:00 GMT</pubDate><author>BioFrontier Test</author></item>
        </channel></rss>`)
      return
    }
    if (request.url === '/flaky-feed.xml') {
      flakyRequests += 1
      if (flakyRequests < 3) {
        response.destroy()
        return
      }
      response.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8' })
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom"><title>重试测试源</title>
        <entry><id>flaky-rss-entry</id><title>连接恢复后的测试文章</title>
        <link rel="alternate" href="http://127.0.0.1/article"/><summary>用于验证瞬时断线后的有限重试。</summary>
        <updated>2026-08-30T12:00:00Z</updated><author><name>BioFrontier Test</name></author></entry>
        </feed>`)
      return
    }
    if (request.url === '/article') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>本地网页导入测试</title>
        <meta name="description" content="验证单个网页可以读取并加入收藏。">
        <meta name="author" content="BioFrontier Test"></head><body>test</body></html>`)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    get flakyRequests() { return flakyRequests },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
