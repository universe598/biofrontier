import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { net } from 'electron'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_RETRIES = 2

export function validatedHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('请输入完整的网址，例如 https://example.org/feed.xml')
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只支持 http 或 https 地址。')
  if (url.username || url.password) throw new Error('不支持在网址中携带用户名或密码。')
  return url
}

export async function fetchCheckedHttp(value: string, init: RequestInit = {}, allowPrivate = false): Promise<Response> {
  const initialUrl = validatedHttpUrl(value)
  const method = String(init.method || 'GET').toUpperCase()
  const maxRetries = method === 'GET' || method === 'HEAD' ? DEFAULT_RETRIES : 0
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (init.signal?.aborted) throw friendlyNetworkError(init.signal.reason, initialUrl)
    try {
      const response = await fetchFollowingRedirects(initialUrl, init, allowPrivate)
      if (!RETRY_STATUSES.has(response.status) || attempt === maxRetries) return response
      await response.body?.cancel().catch(() => undefined)
      await retryDelay(attempt, response.headers.get('retry-after'), init.signal)
    } catch (error) {
      lastError = error
      if (attempt === maxRetries || init.signal?.aborted || !isRetryableNetworkError(error)) {
        throw friendlyNetworkError(error, initialUrl)
      }
      await retryDelay(attempt, null, init.signal)
    }
  }
  throw friendlyNetworkError(lastError, initialUrl)
}

async function fetchFollowingRedirects(initialUrl: URL, init: RequestInit, allowPrivate: boolean): Promise<Response> {
  let url = initialUrl
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!allowPrivate) await assertPublicDestination(url)
    // Electron's networking stack follows the Windows proxy configuration, unlike
    // Node's global fetch. Redirects stay manual so every destination is validated.
    const response = await net.fetch(url.toString(), { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    if (redirects === 5) throw new Error('网址重定向次数过多。')
    await response.body?.cancel().catch(() => undefined)
    url = validatedHttpUrl(new URL(location, url).toString())
  }
  throw new Error('网址重定向失败。')
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  const detail = errorDetail(error).toUpperCase()
  return !detail.includes('ERR_INVALID_URL')
    && !detail.includes('ERR_BLOCKED_BY_CLIENT')
    && !detail.includes('只支持 HTTP')
    && !detail.includes('不支持在网址中携带')
    && !detail.includes('本机与局域网')
}

function friendlyNetworkError(error: unknown, url: URL): Error {
  if (error instanceof Error && isUserFacingNetworkError(error.message)) return error
  const detail = errorDetail(error)
  const upper = detail.toUpperCase()
  const host = url.hostname
  if (upper.includes('ABORT') || upper.includes('TIMEOUT') || upper.includes('ETIMEDOUT')) {
    return new Error(`连接 ${host} 超时，请稍后重试。`)
  }
  if (upper.includes('ECONNRESET') || upper.includes('ERR_CONNECTION_RESET') || upper.includes('SOCKET HANG UP')) {
    return new Error(`连接 ${host} 被远端重置；请检查网络或代理后重试。`)
  }
  if (upper.includes('ENOTFOUND') || upper.includes('EAI_AGAIN') || upper.includes('ERR_NAME_NOT_RESOLVED')) {
    return new Error(`无法解析来源地址：${host}`)
  }
  if (upper.includes('CERT') || upper.includes('TLS') || upper.includes('SSL')) {
    return new Error(`与 ${host} 建立安全连接失败，请检查系统时间、证书或代理。`)
  }
  if (upper.includes('PROXY') || upper.includes('TUNNEL')) {
    return new Error(`无法通过系统代理连接 ${host}，请检查代理设置。`)
  }
  if (upper.includes('ERR_NETWORK_ACCESS_DENIED') || upper.includes('EACCES') || upper.includes('EPERM')) {
    return new Error(`系统或网络策略阻止了对 ${host} 的访问，请检查防火墙或安全软件。`)
  }
  return new Error(`无法连接 ${host}${detail && detail !== 'fetch failed' ? `：${detail}` : '，请检查网络后重试。'}`)
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error || '')
  const cause = error.cause as { code?: unknown; message?: unknown; cause?: unknown } | undefined
  const pieces = [error.message]
  if (cause?.code) pieces.push(String(cause.code))
  if (cause?.message) pieces.push(String(cause.message))
  if (cause?.cause) pieces.push(String(cause.cause))
  return [...new Set(pieces.filter(Boolean))].join(' · ')
}

function isUserFacingNetworkError(message: string): boolean {
  return message.startsWith('网址')
    || message.startsWith('无法解析来源地址')
    || message.startsWith('为保护本机与局域网')
    || message.startsWith('只支持 http')
    || message.startsWith('不支持在网址中携带')
}

async function retryDelay(attempt: number, retryAfter: string | null, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw signal.reason || new Error('请求已取消。')
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0
  const delay = Math.min(5_000, retryAfterSeconds ? retryAfterSeconds * 1_000 : 500 * 2 ** attempt)
  if (!delay) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delay)
    function done(): void {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      reject(signal?.reason || new Error('请求已取消。'))
    }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

async function assertPublicDestination(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) throw privateAddressError()
  const directVersion = isIP(hostname)
  if (directVersion && isPrivateAddress(hostname)) throw privateAddressError()
  if (!directVersion) {
    let addresses: Array<{ address: string }> = []
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true })
    } catch {
      throw new Error(`无法解析来源地址：${hostname}`)
    }
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw privateAddressError()
  }
}

function privateAddressError(): Error {
  return new Error('为保护本机与局域网，默认不访问本地或内网地址。可在设置的高级选项中手动允许。')
}

function isPrivateAddress(value: string): boolean {
  const address = value.toLowerCase().split('%')[0]
  if (address.includes(':')) {
    if (address === '::' || address === '::1') return true
    if (address.startsWith('fc') || address.startsWith('fd')) return true
    if (/^fe[89ab]/.test(address)) return true
    if (address.startsWith('2001:db8:')) return true
    if (address.startsWith('::ffff:')) return isPrivateAddress(address.slice(7))
    return false
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}
