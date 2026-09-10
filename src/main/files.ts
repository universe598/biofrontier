import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Article, DownloadResult } from '../shared/types'
import { fetchCheckedHttp, validatedHttpUrl } from './net'

export async function openArticle(url: string, browser: 'default' | 'chrome'): Promise<void> {
  const validUrl = validateUrl(url)
  if (browser === 'chrome' && process.platform === 'win32') {
    const chrome = findChrome()
    if (chrome) {
      const child = spawn(chrome, [validUrl], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return
    }
  }
  await shell.openExternal(validUrl)
}

export async function downloadArticle(article: Article, libraryPath: string, allowPrivateSources = false): Promise<DownloadResult> {
  const downloadsPath = path.join(libraryPath, 'Downloads')
  await mkdir(downloadsPath, { recursive: true })
  const targetUrl = article.pdfUrl || article.url
  const response = await fetchCheckedHttp(validateUrl(targetUrl), {
    headers: {
      Accept: article.pdfUrl ? 'application/pdf,*/*;q=0.8' : 'text/html,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 BioFrontier/0.1'
    },
    signal: AbortSignal.timeout(60_000)
  }, allowPrivateSources)
  if (!response.ok) {
    return { ok: false, message: `下载失败（HTTP ${response.status}）。请在 Chrome 中打开来源后手动保存。` }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') || ''
  const isPdf = contentType.includes('application/pdf') || bytes.subarray(0, 4).toString() === '%PDF'
  if (article.pdfUrl && !isPdf) {
    return { ok: false, message: '来源没有返回可用的开放 PDF。请在 Chrome 中查看访问权限。' }
  }
  const extension = isPdf ? '.pdf' : '.html'
  const filename = `${sanitizeFilename(article.title).slice(0, 120)}${extension}`
  const destination = uniquePath(downloadsPath, filename)
  await writeFile(destination, bytes)
  return {
    ok: true,
    path: destination,
    message: isPdf ? 'PDF 已保存到本地资料库。' : '网页已保存到本地资料库。'
  }
}

function validateUrl(value: string): string {
  return validatedHttpUrl(value).toString()
}

function findChrome(): string | undefined {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter((item): item is string => Boolean(item))
  return candidates.find((item) => existsSync(item))
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:\"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim() || 'article'
}

function uniquePath(directory: string, filename: string): string {
  const parsed = path.parse(filename)
  let candidate = path.join(directory, filename)
  let suffix = 2
  while (existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${suffix})${parsed.ext}`)
    suffix += 1
  }
  return candidate
}
