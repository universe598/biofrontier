import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import type { Article, ContentSource, Settings } from '../shared/types'
import { fetchCheckedHttp, validatedHttpUrl } from './net'

export type ArticleInput = Omit<Article, 'isRead' | 'isBookmarked' | 'downloadPath' | 'summary'>

interface BiorxivItem {
  doi: string
  title: string
  authors: string
  date: string
  version: string
  category?: string
  abstract?: string
}

interface BiorxivResponse {
  messages?: Array<{ total?: string | number }>
  collection?: BiorxivItem[]
}

interface EuropePmcItem {
  id?: string
  pmid?: string
  pmcid?: string
  doi?: string
  title?: string
  authorString?: string
  abstractText?: string
  firstPublicationDate?: string
  electronicPublicationDate?: string
  elecronicPublicationDate?: string
  printPublicationDate?: string
  firstIndexDate?: string
  dateOfCreation?: string
  journalInfo?: { printPublicationDate?: string }
  journalTitle?: string
}

export async function fetchSource(source: ContentSource, settings: Settings): Promise<ArticleInput[]> {
  if (!source.enabled) return []
  if (source.id === 'pubmed') return fetchPubMed(settings.topics, settings.syncDays)
  if (source.id === 'biorxiv') return fetchPreprints('bioRxiv', settings.syncDays)
  if (source.id === 'medrxiv') return fetchPreprints('medRxiv', settings.syncDays)
  if (source.id === 'arxiv-qbio') return fetchArxivQBio(settings.syncDays)
  if (source.kind === 'rss' && source.url) return fetchRss(source, settings.syncDays, settings.allowPrivateSources)
  throw new Error('暂不支持这个来源类型。')
}

export async function importWebPage(value: string, allowPrivateSources = false): Promise<ArticleInput> {
  const url = validatedHttpUrl(value).toString()
  const response = await fetchCheckedHttp(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 BioFrontier/0.2' },
    signal: AbortSignal.timeout(45_000)
  }, allowPrivateSources)
  if (!response.ok) throw new Error(`网页读取失败（HTTP ${response.status}）`)
  const type = response.headers.get('content-type') || ''
  if (!type.includes('text/html') && !type.includes('application/xhtml')) throw new Error('该地址没有返回可识别的网页。')
  const html = await response.text()
  const resolved = response.url || url
  const title = findMeta(html, 'property', 'og:title') || findMeta(html, 'name', 'twitter:title') || matchTitle(html)
  const description = findMeta(html, 'property', 'og:description') || findMeta(html, 'name', 'description') || ''
  const published = findMeta(html, 'property', 'article:published_time') || findMeta(html, 'name', 'citation_publication_date')
  const host = new URL(resolved).hostname.replace(/^www\./, '')
  return {
    id: `web:${hash(resolved)}`,
    source: host,
    title: normalize(title || resolved),
    authors: normalize(findMeta(html, 'name', 'citation_author') || ''),
    abstract: normalize(description),
    publishedAt: validDate(published) || new Date().toISOString().slice(0, 10),
    discoveredAt: new Date().toISOString(),
    url: resolved,
    category: '手动导入网页',
    isPreprint: false
  }
}

async function fetchPreprints(source: 'bioRxiv' | 'medRxiv', days: number): Promise<ArticleInput[]> {
  const server = source.toLowerCase()
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(1, Math.min(days, 30)))
  const baseUrl = `https://api.biorxiv.org/details/${server}/${dateOnly(start)}/${dateOnly(end)}`
  const first = await fetchJson<BiorxivResponse>(`${baseUrl}/0/json`)
  const total = Number(first.messages?.[0]?.total || first.collection?.length || 0)
  const firstCursor = Math.max(0, total - 90)
  const cursors = [firstCursor, firstCursor + 30, firstCursor + 60].filter((cursor) => cursor < total)
  const remainingCursors = firstCursor === 0 ? cursors.slice(1) : cursors
  const pageResults = await Promise.allSettled(remainingCursors.map((cursor) => fetchJson<BiorxivResponse>(`${baseUrl}/${cursor}/json`)))
  const loadedPages = pageResults
    .filter((result): result is PromiseFulfilledResult<BiorxivResponse> => result.status === 'fulfilled')
    .map((result) => result.value)
  const pages = firstCursor === 0 ? [first, ...loadedPages] : (loadedPages.length ? loadedPages : [first])
  const recent = pages.flatMap((page) => page.collection || []).sort((a, b) => b.date.localeCompare(a.date))
  return recent.slice(0, 90).map((item) => {
    const base = source === 'bioRxiv' ? 'https://www.biorxiv.org' : 'https://www.medrxiv.org'
    const articleUrl = `${base}/content/${item.doi}v${item.version}`
    return {
      id: `${server}:${item.doi}:v${item.version}`,
      source,
      title: normalize(item.title),
      authors: normalize(item.authors),
      abstract: normalize(item.abstract || ''),
      publishedAt: item.date,
      discoveredAt: new Date().toISOString(),
      url: articleUrl,
      pdfUrl: `${articleUrl}.full.pdf`,
      doi: item.doi,
      category: item.category,
      isPreprint: true
    }
  })
}

async function fetchPubMed(topics: string[], days: number): Promise<ArticleInput[]> {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(1, Math.min(days, 14)))
  const topicQuery = topics.length
    ? `(${topics.slice(0, 12).map((topic) => `TITLE_ABS:\"${escapeQuery(topic)}\"`).join(' OR ')})`
    : 'SRC:MED'
  const query = encodeURIComponent(`${topicQuery} AND FIRST_PDATE:[${dateOnly(start)} TO ${dateOnly(end)}] AND NOT (PPR:yes) sort_date:y`)
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=core&pageSize=80`
  const data = await fetchJson<{ resultList?: { result?: EuropePmcItem[] } }>(url)
  return (data.resultList?.result || []).map((item) => {
    const pmid = item.pmid || item.id || ''
    const sourceUrl = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : item.doi ? `https://doi.org/${item.doi}` : 'https://pubmed.ncbi.nlm.nih.gov/'
    const dates = europePmcDates(item)
    return {
      id: `pubmed:${pmid || item.doi || slug(item.title || '')}`,
      source: 'PubMed',
      title: normalize(item.title || '未命名记录'),
      authors: normalize(item.authorString || ''),
      abstract: normalize(item.abstractText || ''),
      publishedAt: dates.publishedAt,
      issueDate: dates.issueDate,
      discoveredAt: new Date().toISOString(),
      url: sourceUrl,
      pdfUrl: item.pmcid ? `https://europepmc.org/articles/${item.pmcid}?pdf=render` : undefined,
      doi: item.doi,
      category: item.journalTitle,
      isPreprint: false
    }
  })
}

async function fetchArxivQBio(days: number): Promise<ArticleInput[]> {
  const url = 'https://export.arxiv.org/api/query?search_query=cat:q-bio.*&start=0&max_results=100&sortBy=submittedDate&sortOrder=descending'
  const response = await fetchCheckedHttp(url, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'BioFrontier/0.8 (personal research reader)' },
    signal: AbortSignal.timeout(45_000)
  })
  if (!response.ok) throw new Error(`arXiv 读取失败（HTTP ${response.status}）`)
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true })
  const document = parser.parse(await response.text()) as Record<string, unknown>
  const entries = asArray(objectValue(document.feed).entry)
  const cutoff = Date.now() - Math.max(1, Math.min(days, 14)) * 24 * 60 * 60 * 1000
  return entries.map((raw) => {
    const entry = objectValue(raw)
    const id = textValue(entry.id)
    const published = validDate(textValue(entry.published)) || validDate(textValue(entry.updated))
    const links = asArray(entry.link).map(objectValue)
    const articleUrl = links.find((link) => textValue(link['@_rel']) === 'alternate')?.['@_href'] || id
    const pdfUrl = links.find((link) => textValue(link['@_title']) === 'pdf')?.['@_href']
    const categories = asArray(entry.category).map((item) => textValue(objectValue(item)['@_term'])).filter(Boolean)
    return {
      id: `arxiv:${id.split('/').pop() || hash(id)}`,
      source: 'arXiv q-bio',
      title: normalize(textValue(entry.title) || '未命名记录'),
      authors: normalize(authorValue(entry.author)),
      abstract: normalize(textValue(entry.summary)),
      publishedAt: published || new Date().toISOString().slice(0, 10),
      discoveredAt: new Date().toISOString(),
      url: String(articleUrl || id),
      pdfUrl: pdfUrl ? String(pdfUrl) : undefined,
      doi: extractDoi(`${textValue(entry['arxiv:doi'])} ${id}`) || undefined,
      category: categories.join(', '),
      isPreprint: true
    }
  }).filter((item) => {
    const time = new Date(item.publishedAt).getTime()
    return !Number.isNaN(time) && time >= cutoff
  })
}

async function fetchRss(source: ContentSource, days: number, allowPrivateSources: boolean): Promise<ArticleInput[]> {
  const feedUrl = validatedHttpUrl(source.url || '').toString()
  const response = await fetchCheckedHttp(feedUrl, {
    headers: { Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.5', 'User-Agent': 'BioFrontier/0.2' },
    signal: AbortSignal.timeout(45_000)
  }, allowPrivateSources)
  if (!response.ok) throw new Error(`RSS 读取失败（HTTP ${response.status}）`)
  const xml = await response.text()
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(xml)) {
    throw new Error('该地址返回了网页而不是 RSS/Atom；订阅地址可能已经变更或需要浏览器登录。')
  }
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true })
  let document: Record<string, unknown>
  try { document = parser.parse(xml) as Record<string, unknown> } catch { throw new Error('返回内容不是有效的 RSS/Atom。') }
  const rssItems = asArray(objectValue(objectValue(document.rss).channel).item)
  const atomItems = asArray(objectValue(document.feed).entry)
  const entries = rssItems.length ? rssItems : atomItems
  if (!entries.length) throw new Error('没有在该地址中找到 RSS/Atom 条目。')
  const cutoff = Date.now() - Math.max(1, Math.min(days, 14)) * 24 * 60 * 60 * 1000
  return entries.slice(0, 100).map((raw) => {
    const entry = objectValue(raw)
    const link = resolveEntryLink(entry.link, feedUrl)
    const identifier = textValue(entry.guid) || textValue(entry.id) || link || textValue(entry.title)
    const published = textValue(entry.pubDate) || textValue(entry.published) || textValue(entry.updated) || textValue(entry.date)
    const author = textValue(entry['dc:creator']) || textValue(entry.creator) || authorValue(entry.author)
    const description = textValue(entry.description) || textValue(entry.summary) || textValue(entry.content) || textValue(entry['content:encoded'])
    const doi = extractDoi(`${identifier} ${link} ${description}`)
    return {
      id: `rss:${source.id}:${hash(identifier)}`,
      source: source.name,
      title: normalize(textValue(entry.title) || '未命名条目'),
      authors: normalize(author),
      abstract: normalize(description),
      publishedAt: validDate(published) || new Date().toISOString().slice(0, 10),
      discoveredAt: new Date().toISOString(),
      url: link || feedUrl,
      pdfUrl: link?.toLowerCase().includes('.pdf') ? link : undefined,
      doi: doi || undefined,
      category: normalize(categoryValue(entry.category)),
      isPreprint: false
    }
  }).filter((item) => {
    const time = new Date(item.publishedAt).getTime()
    return Number.isNaN(time) || time >= cutoff
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchCheckedHttp(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BioFrontier/0.2 (personal research reader)' },
    signal: AbortSignal.timeout(45_000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

function resolveEntryLink(value: unknown, base: string): string {
  for (const candidate of asArray(value)) {
    if (typeof candidate === 'string') return resolveUrl(candidate, base)
    const object = objectValue(candidate)
    const href = textValue(object['@_href']) || textValue(object['#text'])
    const rel = textValue(object['@_rel'])
    if (href && (!rel || rel === 'alternate')) return resolveUrl(href, base)
  }
  return ''
}

function resolveUrl(value: string, base: string): string {
  try { return new URL(value, base).toString() } catch { return '' }
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return decodeEntities(String(value))
  if (Array.isArray(value)) return textValue(value[0])
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return textValue(object['#text'] ?? object['@_term'] ?? object['@_label'])
  }
  return ''
}

function authorValue(value: unknown): string {
  return asArray(value).map((item) => textValue(objectValue(item).name) || textValue(item)).filter(Boolean).join(', ')
}

function categoryValue(value: unknown): string {
  return asArray(value).map((item) => textValue(item)).filter(Boolean).join(', ')
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function findMeta(html: string, attribute: string, value: string): string {
  const normalized = value.toLowerCase()
  for (const tag of html.match(/<meta\s+[^>]*>/gi) || []) {
    const attrs = parseAttributes(tag)
    if ((attrs[attribute] || '').toLowerCase() === normalized) return decodeEntities(attrs.content || '')
  }
  return ''
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([:\w-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  return attributes
}

function matchTitle(html: string): string {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
}

function normalize(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeQuery(value: string): string {
  return value.replace(/[\"\\]/g, ' ').trim()
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function extractDoi(value: string): string {
  return value.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]?.replace(/[.,;)]$/, '').toLowerCase() || ''
}

function validDate(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function europePmcDates(item: EuropePmcItem): { publishedAt: string; issueDate?: string } {
  const today = dateOnly(new Date())
  const electronic = validDate(item.electronicPublicationDate || item.elecronicPublicationDate || '')
  const first = validDate(item.firstPublicationDate || '')
  const indexed = validDate(item.firstIndexDate || '')
  const created = validDate(item.dateOfCreation || '')
  const publishedAt = [electronic, first, created, indexed].find((value) => value && value <= today) || today
  const print = validDate(item.printPublicationDate || item.journalInfo?.printPublicationDate || '')
  const issueDate = print || (first && first > publishedAt ? first : '')
  return { publishedAt, issueDate: issueDate && issueDate !== publishedAt ? issueDate : undefined }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}
