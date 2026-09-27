const { _electron: electron } = require('playwright-core')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '..')
  let app
  try {
    app = await electron.launch({
      executablePath: path.join(root, 'dist', 'win-unpacked', 'BioFrontier.exe'),
      args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(root, '.package-user-data')}`],
      env: { ...process.env, BIOFRONTIER_LIBRARY_PATH: path.join(root, '.package-library') },
      timeout: 30_000
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await acceptAgreementIfShown(page)
    await page.getByRole('heading', { name: '最新生物前沿' }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: /^筛选/ }).click()
    await page.getByLabel('内容来源').waitFor()
    await page.getByText('阅读状态、时间和类型', { exact: true }).click()
    await page.getByLabel('信息状态').waitFor()
    await page.getByLabel('时间范围').selectOption('7')
    await page.getByRole('button', { name: /查看 \d+ 篇/ }).click()
    await page.getByRole('button', { name: '清除全部' }).click()
    await page.getByRole('button', { name: '来源管理' }).click()
    await page.getByRole('heading', { name: '来源管理' }).waitFor()
    await page.getByRole('heading', { name: 'PubMed', exact: true }).waitFor()
    await page.getByRole('button', { name: 'AI 需求匹配' }).click()
    await page.getByRole('heading', { name: 'AI 需求匹配' }).waitFor()
    console.log('Packaged smoke test passed')
  } finally {
    if (app) await app.close()
  }
}

async function acceptAgreementIfShown(page) {
  const heading = page.getByRole('heading', { name: '欢迎使用 BioFrontier' })
  if (!await heading.isVisible().catch(() => false)) return
  await page.getByLabel('我已阅读并同意《应用使用协议》和《隐私说明》').check()
  await page.getByRole('button', { name: '同意并进入应用' }).click()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
