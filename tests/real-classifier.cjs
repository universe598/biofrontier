const { _electron: electron } = require('playwright-core')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '..')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'biofrontier-real-classifier-'))
  const library = path.join(userData, 'library')
  fs.mkdirSync(library)
  seedArticle(path.join(userData, 'biofrontier.sqlite'))
  const packagedExecutable = process.env.BIOFRONTIER_TEST_EXECUTABLE
  let app
  try {
    app = await electron.launch({
      executablePath: packagedExecutable || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: packagedExecutable ? ['--no-sandbox', `--user-data-dir=${userData}`] : [root, '--no-sandbox', `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        BIOFRONTIER_LIBRARY_PATH: library,
        BIOFRONTIER_RESEARCH_OFFLINE: '1',
        ...(packagedExecutable ? {} : { BIOFRONTIER_CLASSIFIER_PATH: path.resolve(root, '..', 'classifier-bundle', 'classifier') })
      },
      timeout: 30_000
    })
    const page = await app.firstWindow()
    await acceptAgreementIfShown(page)
    await page.getByRole('heading', { name: '最新生物前沿' }).waitFor()
    await page.getByRole('button', { name: '设置' }).click()
    await page.getByRole('heading', { name: '设置' }).waitFor()
    await page.getByText('BioFrontier Qwen3 8B 本地研究与分类模型').waitFor()
    await page.getByRole('group', { name: '文章分类方式' }).getByRole('button', { name: /本地 AI/ }).click()
    await page.getByRole('button', { name: '保存设置' }).click()
    await page.waitForFunction(async () => (await window.biofrontier.settings.get()).classificationMode === 'local')
    const result = await page.evaluate(() => window.biofrontier.classifier.run())
    const status = await page.evaluate(() => window.biofrontier.classifier.status())
    if (result.failed) throw new Error(`Classifier failed: ${status.lastError || 'unknown error'}`)
    if (result.processed !== 2) throw new Error(`Unexpected result: ${JSON.stringify(result)}`)
    await page.reload()
    await page.getByRole('heading', { name: '最新生物前沿' }).waitFor()
    const article = page.getByRole('heading', { name: 'CRISPR base editing repairs a pathogenic mutation in human stem cells', exact: true }).first().locator('..')
    await article.locator('.local-model-badge', { hasText: '本地 8B' }).waitFor()
    const primary = await article.locator('.primary-category-badge').textContent()
    const secondary = await article.locator('.secondary-category-badge').textContent()
    if (primary !== '生物技术、计算与研究方法' || secondary !== '基因编辑') {
      throw new Error(`Unexpected category: ${primary} > ${secondary}`)
    }
    const populationArticle = page.getByRole('heading', { name: 'Temperature and the Composition of Diets: Evidence from China', exact: true }).first().locator('..')
    const populationPrimary = await populationArticle.locator('.primary-category-badge').textContent()
    const populationSecondary = await populationArticle.locator('.secondary-category-badge').textContent()
    if (populationPrimary !== '公共卫生与人群研究' || !['营养与健康', '环境健康', '健康经济与政策'].includes(populationSecondary)) {
      throw new Error(`Unexpected population category: ${populationPrimary} > ${populationSecondary}`)
    }
    await page.getByRole('button', { name: 'AI 专题速报' }).click()
    await page.getByLabel('这次要追踪什么研究问题？').fill('CRISPR基因编辑修复人类干细胞致病突变的近期证据')
    await page.getByRole('button', { name: '使用本地 AI 生成' }).click()
    await page.getByText(/查看全部 \d+ 个原始来源/).waitFor({ timeout: 8 * 60_000 })
    const researchStatus = await page.evaluate(() => window.biofrontier.research.status())
    if (researchStatus.phase !== 'completed' || !researchStatus.report || researchStatus.report.coverage.analyzed < 1) {
      throw new Error(`Unexpected research result: ${JSON.stringify(researchStatus)}`)
    }
    console.log('Real classifier integration test passed')
  } finally {
    if (app) await app.close()
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

async function acceptAgreementIfShown(page) {
  const heading = page.getByRole('heading', { name: '欢迎使用 BioFrontier' })
  if (!await heading.isVisible().catch(() => false)) return
  await page.getByLabel('我已阅读并同意《应用使用协议》和《隐私说明》').check()
  await page.getByRole('button', { name: '同意并进入应用' }).click()
}

function seedArticle(databasePath) {
  const db = new DatabaseSync(databasePath)
  db.exec(`CREATE TABLE articles (
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
  )`)
  const insert = db.prepare(`INSERT INTO articles (
    id, source, title, authors, abstract, published_at, discovered_at, url, category, is_preprint
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
  insert.run(
    'real-classifier:genetics',
    'Local Test Source',
    'CRISPR base editing repairs a pathogenic mutation in human stem cells',
    'BioFrontier Test',
    'We develop an adenine base editor that corrects a pathogenic point mutation in patient-derived human stem cells. Whole-genome sequencing evaluates off-target variants and edited cells recover normal differentiation.',
    '2026-08-30',
    new Date().toISOString(),
    'https://example.org/real-classifier-test',
    'Genetics and genomics'
  )
  insert.run(
    'real-classifier:population-health',
    'medRxiv',
    'Temperature and the Composition of Diets: Evidence from China',
    'BioFrontier Test',
    'Using three-day dietary recalls from the China Health and Nutrition Survey matched to county weather, we show that short-run departures from comfort temperature raise the fat share of energy intake. The study evaluates how climate and food consumption affect human welfare and population health.',
    '2026-08-29',
    new Date().toISOString(),
    'https://example.org/population-health-test',
    'health economics'
  )
  db.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
