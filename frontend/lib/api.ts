// frontend/lib/api.ts
//
// Typed client for every UniStream API endpoint. Ordinary requests go through
// the same-origin /api rewrite (next.config.js); the SSE progress stream and
// the long YouTube check connect straight to FastAPI because the rewrite proxy
// can buffer or time out on them.
//
// Two separate Bearer tokens: user endpoints carry the user session
// (lib/auth.ts), /admin/* carries the admin session (lib/adminAuth.ts). Neither
// is ever put in a URL: the download stream authenticates with a short-lived,
// single-use ticket from POST /download/ticket instead.

import axios, { isAxiosError, type AxiosRequestConfig } from 'axios'
import { clearSession, getToken, setSession, SESSION_EXPIRED_PATH } from './auth'
import {
  expireAdminSession,
  getAdminToken,
  setAdminSession,
  updateAdminSession,
  type AdminAuthResponse,
} from './adminAuth'
import type { Platform } from './validation'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't sign out + redirect on 401 (the caller handles it). */
    skipAuthRedirect?: boolean
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

export type { Platform } from './validation'
export type UserStatus = 'approved' | 'pending' | 'blocked'

/** Today's download allowance. `limit`/`remaining` are null for unlimited accounts. */
export interface Usage {
  used: number
  limit: number | null
  remaining: number | null
  /** ISO instant of the next reset (local midnight in `timezone`). */
  resets_at: string
  /** IANA zone the day is counted in, e.g. "Asia/Dhaka". */
  timezone: string
}

/** The signed-in user as the user-facing API returns it. */
export interface PublicUser {
  id: string
  /** Legacy accounts created before v2 may lack name/email/phone. */
  name: string | null
  email: string | null
  /** E.164, e.g. "+8801712345678". */
  phone: string | null
  status: UserStatus
  /** True while the user still has the admin-issued temporary password. */
  temp_password: boolean
  created_at: string | null
  usage: Usage
}

/** A user row in the admin panel. Timestamps are ISO strings or null. */
export interface AdminUser {
  id: string
  identifier: string
  name: string | null
  email: string | null
  phone: string | null
  note: string | null
  status: UserStatus
  /** null = default limit, -1 = unlimited, >= 0 = custom. */
  daily_limit: number | null
  /** Resolved limit; null = unlimited. */
  effective_limit: number | null
  used_today: number
  total_downloads: number
  has_password: boolean
  temp_password: boolean
  approved_at: string | null
  credentials_sent_at: string | null
  last_login_at: string | null
  last_download_at: string | null
  created_at: string | null
  updated_at: string | null
}

/** Outcome of issuing a password. `password` is only present when the email was NOT sent. */
export interface CredentialsResult {
  emailed: boolean
  email_error: string | null
  password: string | null
}

/** One completed download in the audit log. */
export interface LogEntry {
  id: string
  user_id: string | null
  identifier: string
  url: string
  title: string | null
  /** Display label, e.g. "YouTube" (older rows may hold other values). */
  platform: string | null
  /** e.g. "1080p MP4", "MP3". */
  quality: string | null
  file_size: number | null
  created_at: string
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface UserCounts {
  total: number
  pending: number
  approved: number
  blocked: number
}

export interface EmailStatus {
  configured: boolean
  provider: 'brevo' | 'resend' | 'smtp' | null
  from_email: string | null
  from_name: string
  /** What is missing when not configured. */
  issue?: string | null
}

export interface SchemaStatus {
  ready: boolean
  /** Missing columns/tables/functions, e.g. "users.password_hash". */
  missing: string[]
  checked_at?: string
}

/** GET /admin/schema: status plus the SQL to run in Supabase. */
export interface SchemaInfo {
  ready: boolean
  missing: string[]
  migration_sql: string
}

export interface DailyCount {
  /** YYYY-MM-DD in the app timezone. */
  date: string
  count: number
}

export interface Overview {
  users: UserCounts
  downloads: {
    today: number
    last_7_days: number
    last_30_days: number
    /** Last 14 days including today, zero-filled, oldest first. */
    daily: DailyCount[]
    /** Last 30 days by platform label, e.g. { YouTube: 12, Facebook: 3, Instagram: 1 }. */
    platforms: Record<string, number>
  }
  settings: { default_daily_limit: number }
  system: {
    schema_ready: boolean
    email: EmailStatus
    auth_secret_configured: boolean
    storage: 'supabase' | 'sqlite'
    persistent: boolean
    timezone: string
  }
}

export interface Settings {
  default_daily_limit: number
  timezone: string
  email: EmailStatus
  auth_secret_configured: boolean
  schema: SchemaStatus
  frontend_url: string
}

export interface StorageHealth {
  active_backend: 'supabase' | 'sqlite'
  persistent: boolean
  reachable: boolean
  user_count?: number | null
  download_log_count?: number | null
  status_counts?: Partial<Record<UserStatus, number>> | null
  schema?: SchemaStatus
  youtube_auth?: string
  youtube_proxy?: string
  js_runtime?: string | null
  yt_dlp_version?: string
  ffmpeg_location?: string | null
  configuration_warning?: string | null
  error?: string | null
  last_remote_error?: string | null
  [key: string]: unknown
}

export interface YoutubeCheckResult {
  commit?: string
  yt_dlp_version?: string
  youtube_auth?: string
  youtube_proxy?: string
  js_runtime?: string | null
  clients?: unknown
  [key: string]: unknown
}

/** File types the API produces (and accepts for a download ticket). */
export type DownloadExt = 'mp4' | 'mp3'

export interface VideoFormat {
  type: 'video' | 'audio'
  format_id: string
  label: string
  icon: string
  resolution: string
  ext: DownloadExt
  filesize_bytes: number | null
  filesize_human: string
  bitrate?: string
  fps?: string
}

export interface VideoInfo {
  title: string
  thumbnail: string
  duration: number
  uploader: string
  platform: string
  formats: VideoFormat[]
  notice?: string | null
  /** Extraction attempt that listed these formats; pass back as `source` when downloading. */
  source?: string | null
  view_count?: number
  like_count?: number
  upload_date?: string
  id?: string
}

// ── Request bodies ────────────────────────────────────────────────────────────

export interface MessageResponse {
  message: string
}

/** Login, reset-password and change-password all return a fresh session. */
export interface AuthResponse {
  token: string
  user: PublicUser
  message?: string
}

export interface RegisterRequest {
  name: string
  email: string
  /** Send the normalised E.164 value from validatePhone(). */
  phone: string
  /** Institution / department (optional). */
  note?: string | null
}

export type UserSort =
  | 'created_at'
  | 'name'
  | 'last_login_at'
  | 'last_download_at'
  | 'total_downloads'
  | 'status'

export interface AdminUserQuery {
  status?: UserStatus
  q?: string
  page?: number
  page_size?: number
  sort?: UserSort
  order?: 'asc' | 'desc'
}

export interface AdminCreateUserRequest {
  name: string
  email: string
  phone: string
  note?: string | null
  /** null/omitted = default, -1 = unlimited, 0..10000 = custom. */
  daily_limit?: number | null
  /** Default "approved". */
  status?: 'approved' | 'pending'
  /** Generate a password and email it (default true; only for approved users). */
  send_credentials?: boolean
}

/** Only the keys present are changed; `daily_limit: null` resets to the default limit. */
export interface AdminUpdateUserRequest {
  name?: string
  email?: string
  phone?: string
  note?: string | null
  daily_limit?: number | null
}

export interface UserWithCredentials {
  user: AdminUser
  credentials: CredentialsResult | null
}

export type BulkAction = 'approve' | 'block' | 'pending' | 'delete'

export interface BulkResult {
  id: string
  ok: boolean
  error: string | null
  credentials: CredentialsResult | null
}

export interface LogFilters {
  q?: string
  /** Platform label as stored, e.g. "YouTube". */
  platform?: string
  user_id?: string
  /** YYYY-MM-DD, inclusive, in the app timezone. */
  date_from?: string
  /** YYYY-MM-DD, inclusive, in the app timezone. */
  date_to?: string
}

export interface LogQuery extends LogFilters {
  page?: number
  page_size?: number
}

/** Exactly one of the three forms. */
export type PurgeRequest =
  | { older_than_days: number }
  | { before: string }
  | { all: true }

// ── Admin account ─────────────────────────────────────────────────────────────

export type { AdminAuthResponse, AdminSession } from './adminAuth'

/** GET /admin/auth/me. */
export interface AdminMe {
  username: string
  /** Signed in with the bootstrap password: the UI must force new credentials first. */
  must_change_password: boolean
  /** ADMIN_RESET_PASSWORD is set on the server: warn the owner to remove it after resetting. */
  recovery_mode: boolean
}

/** POST /admin/auth/change-credentials. */
export interface AdminChangeCredentialsRequest {
  current_password: string
  /** 10–128 characters with at least one letter and one digit; must differ from the current one. */
  new_password: string
  /** 3–32 characters of a–z, 0–9, '.', '_' or '-'; omit (or leave empty) to keep the current username. */
  new_username?: string | null
}

// ── Download progress (SSE) ───────────────────────────────────────────────────

export type DownloadStatus = 'starting' | 'downloading' | 'merging' | 'complete' | 'error'

/** Why a download was refused before it started (SSE cannot carry HTTP status codes). */
export type DownloadErrorCode = 'auth' | 'limit' | 'platform' | 'busy'

/** One SSE progress event, normalised by parseProgressEvent(). */
export interface DownloadProgressEvent {
  status: DownloadStatus
  percent: number
  speed: string
  eta: string
  downloaded_fmt: string
  total_fmt: string
  downloaded: number
  total: number | null
  job_id?: string
  /** On `complete`: one-time token for downloadFileUrl(). */
  token?: string
  /** On `error`: message to show. */
  error?: string
  /** On pre-flight `error`s. */
  code?: DownloadErrorCode
  /** On `complete`: the user's usage after this download counted. */
  usage?: Usage
}

/** POST /download/ticket body: everything the progress stream needs, signed into the ticket. */
export interface DownloadTicketRequest {
  url: string
  format_id: string
  ext: DownloadExt
  /** Video height in pixels; lets the server pick the matching YouTube stream. null for audio. */
  height?: number | null
  /** VideoInfo.source from the analysis. */
  source?: string | null
}

/** A single-use pass for one GET /download/progress stream. */
export interface DownloadTicket {
  ticket: string
  /** Seconds until the ticket expires (60): open the stream right away. */
  expires_in: number
}

// ═════════════════════════════════════════════════════════════════════════════
// Client
// ═════════════════════════════════════════════════════════════════════════════

/** FastAPI origin for direct connections (SSE, long admin checks). */
export const BACKEND_ORIGIN = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || 'http://localhost:8000').replace(/\/+$/, '')

// The API sleeps on Render's free tier and takes ~50-60s to answer the first
// request after it spins down, so the timeout has to outlast a cold start —
// at 30s the first login of the day always failed with a network error.
const API = axios.create({
  baseURL: '/api',
  timeout: 120000,
})

function isAdminPath(url: string | undefined): boolean {
  return /^\/?admin(\/|$|\?)/.test(url ?? '')
}

function isLoginPath(url: string | undefined): boolean {
  return /^\/?auth\/login(\/|$|\?)/.test(url ?? '')
}

/** A 401 from admin login means wrong credentials, not an expired session. */
function isAdminLoginPath(url: string | undefined): boolean {
  return /^\/?admin\/auth\/login(\/|$|\?)/.test(url ?? '')
}

API.interceptors.request.use(config => {
  // Each side only ever sees its own token: the user session never reaches
  // /admin/*, and the admin token never reaches user endpoints.
  if (!config.headers.has('Authorization')) {
    const admin = isAdminPath(config.url)
    const token = admin ? (isAdminLoginPath(config.url) ? null : getAdminToken()) : getToken()
    if (token) config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

API.interceptors.response.use(
  response => response,
  (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 401 && error.config) {
      const { config } = error
      const sent = config.headers?.get?.('Authorization')
      const sentToken = typeof sent === 'string' ? sent.replace(/^Bearer\s+/i, '') : null
      if (config.skipAuthRedirect) {
        // The caller handles it.
      } else if (isAdminPath(config.url)) {
        if (!isAdminLoginPath(config.url)) handleExpiredAdminSession(sentToken)
      } else if (sentToken && !isLoginPath(config.url)) {
        handleExpiredSession()
      }
    }
    return Promise.reject(error)
  },
)

/** The session was rejected: forget it and send the user to sign in again. */
function handleExpiredSession(): void {
  clearSession({ expired: true })
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    window.location.replace(SESSION_EXPIRED_PATH)
  }
}

/**
 * The admin token was rejected: clear it and fire the expiry event so the
 * admin UI swaps to its sign-in screen in place (no redirect). A late 401 for
 * a token that has since been replaced (by change-credentials or a new
 * sign-in) must not end the newer session.
 */
function handleExpiredAdminSession(sentToken: string | null): void {
  const current = getAdminToken()
  if (current && sentToken !== current) return
  expireAdminSession()
}

/** Drop empty values so the query string has no `q=&platform=`. */
function cleanParams<T extends object>(params: T | undefined): Partial<T> {
  const out: Partial<T> = {}
  if (!params) return out
  for (const [key, value] of Object.entries(params) as [keyof T, T[keyof T]][]) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    out[key] = (typeof value === 'string' ? value.trim() : value) as T[keyof T]
  }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// Errors
// ═════════════════════════════════════════════════════════════════════════════

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Please check the details and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: 'Not found. It may have been removed.',
  409: 'That conflicts with existing data.',
  413: 'That request is too large.',
  422: 'Please check the details and try again.',
  429: 'Too many requests. Please wait a few minutes and try again.',
  500: 'Something went wrong on our side. Please try again.',
  502: 'The server is starting up or unreachable. Please try again in a minute.',
  503: 'The service is temporarily unavailable. Please try again in a minute.',
  504: 'The server took too long to respond. Please try again in a minute.',
}

/** FastAPI's `detail` as one readable string (also handles raw pydantic error lists). */
function detailOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const { detail, message } = data as { detail?: unknown; message?: unknown }
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map(item => (item && typeof item === 'object' ? (item as { msg?: unknown }).msg : item))
      .filter((msg): msg is string => typeof msg === 'string' && Boolean(msg))
      .map(msg => msg.replace(/^Value error, /, ''))
    if (parts.length) return parts.join(' ')
  }
  if (typeof message === 'string' && message.trim()) return message.trim()
  return null
}

/** HTTP status of a failed API call, or undefined for network errors / non-API errors. */
export function apiErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined
}

/**
 * A message fit to show the user for any thrown value: the API's `detail`,
 * else a friendly text for the status, network failure or timeout.
 * Storage outages (503) on user endpoints get a generic message; admin
 * endpoints keep the API's detail because it says what to fix.
 */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isAxiosError(err)) {
    if (err.code === 'ERR_CANCELED') return 'The request was cancelled.'
    const response = err.response
    if (!response) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return "You're offline. Check your internet connection and try again."
      }
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return 'The server took too long to respond. It may be starting up — please try again in a moment.'
      }
      return "Can't reach the server. Check your internet connection and try again."
    }
    const status = response.status
    const detail = detailOf(response.data)
    if (status === 503 && !isAdminPath(err.config?.url)) return STATUS_MESSAGES[503]
    if (detail) return detail
    return STATUS_MESSAGES[status] ?? (status >= 500 ? STATUS_MESSAGES[500] : fallback)
  }
  // Plain Errors thrown on purpose by page code carry a user-facing message;
  // TypeErrors and the like are bugs, not something to show.
  if (err instanceof Error && err.name === 'Error' && err.message) return err.message
  return fallback
}

// ═════════════════════════════════════════════════════════════════════════════
// Public / user endpoints
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget ping that starts the backend spinning up while the user is
 * still typing, so the request that matters isn't the one paying the cold start.
 */
export function warmBackend(): void {
  // '' resolves to '/api' itself; '/api/' would first bounce off a 308 redirect.
  API.get('', { timeout: 120000 }).catch(() => { /* best effort */ })
}

/** POST /auth/register — request access; the account starts as pending. */
export async function register(body: RegisterRequest): Promise<MessageResponse> {
  const { data } = await API.post<MessageResponse>('/auth/register', cleanParams(body))
  return data
}

/**
 * POST /auth/login with an email or phone (normalise with classifyLogin()).
 * Stores the session on success.
 */
export async function login(loginValue: string, password: string): Promise<AuthResponse> {
  const { data } = await API.post<AuthResponse>('/auth/login', { login: loginValue, password })
  setSession(data.token, data.user)
  return data
}

/** POST /auth/forgot-password — always resolves with the same neutral message. */
export async function forgotPassword(email: string): Promise<MessageResponse> {
  const { data } = await API.post<MessageResponse>('/auth/forgot-password', { email })
  return data
}

/** POST /auth/reset-password — sets the new password and signs in (session stored). */
export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  const { data } = await API.post<AuthResponse>('/auth/reset-password', { token, password })
  setSession(data.token, data.user)
  return data
}

/** GET /auth/me — the current user with today's usage. */
export async function getMe(config: Pick<AxiosRequestConfig, 'skipAuthRedirect' | 'signal'> = {}): Promise<{ user: PublicUser }> {
  const { data } = await API.get<{ user: PublicUser }>('/auth/me', config)
  return data
}

/**
 * POST /auth/change-password. The old token stops working, so the new
 * session returned by the API is stored automatically.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResponse> {
  const { data } = await API.post<AuthResponse>('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  setSession(data.token, data.user)
  return data
}

/** POST /video-info — analyse a YouTube/Facebook/Instagram link (does not count toward the limit). */
export async function getVideoInfo(url: string, config: Pick<AxiosRequestConfig, 'signal'> = {}): Promise<VideoInfo> {
  const { data } = await API.post<VideoInfo>('/video-info', { url }, config)
  return data
}

/**
 * POST /download/ticket — step 1 of a download. Runs the platform, account and
 * daily-limit checks and returns a single-use ticket valid for 60 seconds; it
 * does not use up a download (only a completed download counts).
 *
 * Rejects with the API's `detail`: 400 unsupported link, 401 (session expired:
 * handled like every user endpoint), 403 account blocked/pending, 429 daily
 * limit reached (see isDailyLimitError) or too many attempts.
 */
export async function createDownloadTicket(
  body: DownloadTicketRequest,
  config: Pick<AxiosRequestConfig, 'signal'> = {},
): Promise<DownloadTicket> {
  const height = typeof body.height === 'number' && body.height > 0 ? Math.round(body.height) : null
  const { data } = await API.post<DownloadTicket>(
    '/download/ticket',
    { url: body.url, format_id: body.format_id, ext: body.ext, height, source: body.source || null },
    config,
  )
  return data
}

/**
 * Step 2: the EventSource URL for GET /download/progress. Connects straight to
 * FastAPI (the rewrite proxy can buffer SSE). The ticket replaces the session
 * token, which must never appear in a URL; open it immediately — it expires in
 * 60 seconds and works once, so a retry needs a new ticket.
 */
export function downloadProgressUrl(ticket: string): string {
  return `${BACKEND_ORIGIN}/download/progress?ticket=${encodeURIComponent(ticket)}`
}

/**
 * True when a ticket request was refused because no download can count today:
 * today's downloads are used up (429 "You've used all N downloads for today…",
 * or "…for today are already in progress"), or downloads are turned off for
 * the account (429 "Downloads are turned off…", a limit of 0). Not the
 * per-hour attempt limit. Show the quota banner (and refresh usage) for these.
 */
export function isDailyLimitError(err: unknown): boolean {
  if (!isAxiosError(err) || err.response?.status !== 429) return false
  const detail = detailOf(err.response.data) ?? ''
  return /downloads? for today|downloads are turned off/i.test(detail)
}

/** URL that saves the finished file (token from the `complete` event; single use, 5 minutes). */
export function downloadFileUrl(fileToken: string): string {
  return `/api/download/file?token=${encodeURIComponent(fileToken)}`
}

/** Parse one SSE `data:` payload, filling defaults; null if it isn't valid JSON. */
export function parseProgressEvent(raw: string): DownloadProgressEvent | null {
  let data: Partial<DownloadProgressEvent> & { status?: string }
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') return null
  return {
    ...data,
    status: data.status as DownloadStatus,
    percent: typeof data.percent === 'number' ? data.percent : 0,
    speed: data.speed ?? '',
    eta: data.eta ?? '--:--',
    downloaded_fmt: data.downloaded_fmt ?? '0 KB',
    total_fmt: data.total_fmt ?? '?',
    downloaded: data.downloaded ?? 0,
    total: data.total ?? null,
  }
}

/** True when the user may start another download today. */
export function hasDownloadsLeft(usage: Usage | null | undefined): boolean {
  if (!usage) return false
  return usage.limit === null || (usage.remaining ?? usage.limit - usage.used) > 0
}

/** True for unlimited accounts. */
export function isUnlimited(usage: Usage | null | undefined): boolean {
  return !!usage && usage.limit === null
}

// ═════════════════════════════════════════════════════════════════════════════
// Admin endpoints
//
// Every /admin/* call carries the admin Bearer token from lib/adminAuth.ts
// (added by the request interceptor). A 401 clears the admin session and fires
// ADMIN_SESSION_EXPIRED_EVENT ('unistream:admin-session-expired') so the admin
// UI shows its sign-in screen; the promise still rejects for the caller.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /admin/auth/login — sign in to the dashboard and store the admin
 * session (localStorage when `remember`, else sessionStorage; 7 days vs 12 h).
 * Rejects with 401 "Incorrect username or password." or 429 (rate limited).
 * When the result says `must_change_password`, show the "Set your admin
 * username and password" screen before the dashboard.
 */
export async function adminLogin(username: string, password: string, remember = false): Promise<AdminAuthResponse> {
  const { data } = await API.post<AdminAuthResponse>('/admin/auth/login', {
    username: username.trim(),
    password,
    remember,
  })
  setAdminSession(data, remember)
  return data
}

/** GET /admin/auth/me — who is signed in, whether new credentials are required, and recovery mode. */
export async function adminMe(config: Pick<AxiosRequestConfig, 'signal'> = {}): Promise<AdminMe> {
  const { data } = await API.get<AdminMe>('/admin/auth/me', config)
  updateAdminSession({ username: data.username, must_change_password: data.must_change_password })
  return data
}

/**
 * POST /admin/auth/change-credentials — set a new password (and optionally a
 * new username). Every other admin session ends; the fresh token returned is
 * stored automatically, keeping the "Keep me signed in" choice.
 * Rejects with 400 "Your current password is incorrect." / validation detail,
 * or 503 when the database migration has not been run yet.
 */
export async function adminChangeCredentials(body: AdminChangeCredentialsRequest): Promise<AdminAuthResponse> {
  const newUsername = body.new_username?.trim()
  const { data } = await API.post<AdminAuthResponse>('/admin/auth/change-credentials', {
    current_password: body.current_password,
    new_password: body.new_password,
    ...(newUsername ? { new_username: newUsername } : {}),
  })
  setAdminSession(data)
  return data
}

/** GET /admin/overview — dashboard counters, 14-day chart data and system status. */
export async function adminOverview(): Promise<Overview> {
  const { data } = await API.get<Overview>('/admin/overview')
  return data
}

/** GET /admin/users — search, filter, sort and paginate users. */
export async function adminListUsers(query: AdminUserQuery = {}): Promise<Paginated<AdminUser>> {
  const { data } = await API.get<Paginated<AdminUser>>('/admin/users', { params: cleanParams(query) })
  return data
}

/** POST /admin/users — add a user (approved by default, credentials emailed by default). */
export async function adminCreateUser(body: AdminCreateUserRequest): Promise<UserWithCredentials> {
  const { data } = await API.post<UserWithCredentials>('/admin/users', body)
  return data
}

/** PATCH /admin/users/{id} — edit profile fields and the daily limit. */
export async function adminUpdateUser(id: string, body: AdminUpdateUserRequest): Promise<{ user: AdminUser }> {
  const { data } = await API.patch<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, body)
  return data
}

/** POST /admin/users/{id}/approve — approve and (by default) email a new temporary password. */
export async function adminApproveUser(
  id: string,
  options: { sendCredentials?: boolean } = {},
): Promise<UserWithCredentials> {
  const { data } = await API.post<UserWithCredentials>(`/admin/users/${encodeURIComponent(id)}/approve`, {
    send_credentials: options.sendCredentials ?? true,
  })
  return data
}

/** POST /admin/users/{id}/status — approve / move to pending / block without sending a password. */
export async function adminSetUserStatus(id: string, status: UserStatus): Promise<{ user: AdminUser }> {
  const { data } = await API.post<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}/status`, { status })
  return data
}

/** POST /admin/users/{id}/send-password — new temporary password (signs the user out everywhere). */
export async function adminSendPassword(id: string): Promise<UserWithCredentials> {
  const { data } = await API.post<UserWithCredentials>(`/admin/users/${encodeURIComponent(id)}/send-password`, {})
  return data
}

/** POST /admin/users/{id}/reset-usage — give back today's downloads. */
export async function adminResetUsage(id: string): Promise<{ user: AdminUser }> {
  const { data } = await API.post<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}/reset-usage`, {})
  return data
}

/** DELETE /admin/users/{id}. Their download logs stay (user_id becomes null). */
export async function adminDeleteUser(id: string): Promise<{ deleted: boolean }> {
  const { data } = await API.delete<{ deleted: boolean }>(`/admin/users/${encodeURIComponent(id)}`)
  return data
}

/** POST /admin/users/bulk — apply one action to up to 200 users; per-user results. */
export async function adminBulkUsers(
  ids: string[],
  action: BulkAction,
  options: { sendCredentials?: boolean } = {},
): Promise<{ results: BulkResult[] }> {
  const { data } = await API.post<{ results: BulkResult[] }>('/admin/users/bulk', {
    ids,
    action,
    send_credentials: options.sendCredentials ?? true,
  })
  return data
}

/** GET /admin/logs — newest first, filtered and paginated. */
export async function adminListLogs(query: LogQuery = {}): Promise<Paginated<LogEntry>> {
  const { data } = await API.get<Paginated<LogEntry>>('/admin/logs', { params: cleanParams(query) })
  return data
}

/** DELETE /admin/logs/{id}. */
export async function adminDeleteLog(id: string): Promise<{ deleted: number }> {
  const { data } = await API.delete<{ deleted: number }>(`/admin/logs/${encodeURIComponent(id)}`)
  return data
}

/** POST /admin/logs/delete — delete up to 500 selected logs. */
export async function adminDeleteLogs(ids: string[]): Promise<{ deleted: number }> {
  const { data } = await API.post<{ deleted: number }>('/admin/logs/delete', { ids })
  return data
}

/** POST /admin/logs/purge — delete old logs in bulk (older than N days, before a date, or all). */
export async function adminPurgeLogs(body: PurgeRequest): Promise<{ deleted: number }> {
  const { data } = await API.post<{ deleted: number }>('/admin/logs/purge', body, {
    // Deleting a large history can take a while on Supabase.
    timeout: 300000,
  })
  return data
}

/**
 * GET /admin/logs/export — download the filtered logs as CSV (max 50,000 rows).
 * Fetched with the admin Bearer token (a plain link could not send it), then
 * handed to the browser's save dialog; resolves once the file is handed over.
 */
export async function adminExportLogs(filters: LogFilters = {}): Promise<void> {
  try {
    const response = await API.get<Blob>('/admin/logs/export', {
      params: cleanParams(filters),
      responseType: 'blob',
      timeout: 300000,
    })
    const disposition = String(response.headers['content-disposition'] ?? '')
    const fallback = `download-logs-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
    saveBlob(response.data, filenameFrom(disposition) ?? fallback)
  } catch (err) {
    // Error bodies arrive as Blobs too; decode them so apiErrorMessage sees `detail`.
    if (isAxiosError(err) && err.response?.data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await err.response.data.text())
      } catch {
        err.response.data = null
      }
    }
    throw err
  }
}

function filenameFrom(disposition: string): string | null {
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1].trim() : null
}

/** Save a Blob as a file via a temporary object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in Safari.
  window.setTimeout(() => URL.revokeObjectURL(href), 10000)
}

/** GET /admin/settings. */
export async function adminGetSettings(): Promise<Settings> {
  const { data } = await API.get<Settings>('/admin/settings')
  return data
}

/** PUT /admin/settings — change the default daily limit (0..10000). */
export async function adminUpdateSettings(body: { default_daily_limit: number }): Promise<Settings> {
  const { data } = await API.put<Settings>('/admin/settings', body)
  return data
}

/** POST /admin/email/test — send a test email; rejects (502) with the provider's reason. */
export async function adminSendTestEmail(to: string): Promise<{ sent: boolean }> {
  const { data } = await API.post<{ sent: boolean }>('/admin/email/test', { to }, { timeout: 60000 })
  return data
}

/** GET /admin/schema — database status and the migration SQL to run (works before the migration). */
export async function adminGetSchema(): Promise<SchemaInfo> {
  const { data } = await API.get<SchemaInfo>('/admin/schema')
  return data
}

/** GET /admin/storage — which database is live and the download toolchain versions. */
export async function adminGetStorage(): Promise<StorageHealth> {
  const { data } = await API.get<StorageHealth>('/admin/storage')
  return data
}

// Probes every YouTube client from the server and can take a few minutes, so
// it goes straight to the API rather than through the /api rewrite proxy. It
// still uses the shared client, so it carries the admin Bearer token and a
// 401 expires the admin session like any other admin call.
/** GET /admin/youtube-check — which YouTube clients list which resolutions from the server. */
export async function adminYoutubeCheck(url?: string): Promise<YoutubeCheckResult> {
  const { data } = await API.get<YoutubeCheckResult>('/admin/youtube-check', {
    baseURL: BACKEND_ORIGIN,
    params: url ? { url } : undefined,
    timeout: 300000,
  })
  return data
}

/** Platform key → label used in logs and stats ("youtube" → "YouTube"). */
export function platformLabel(platform: Platform | string | null | undefined): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'youtube':
      return 'YouTube'
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    default:
      return platform ?? ''
  }
}
