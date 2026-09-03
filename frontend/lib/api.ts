// frontend/lib/api.ts
import axios from 'axios'

// The API sleeps on Render's free tier and takes ~50-60s to answer the first
// request after it spins down, so the timeout has to outlast a cold start —
// at 30s the first login of the day always failed with a network error.
const API = axios.create({
  baseURL: '/api',
  timeout: 120000,
})

/**
 * Fire-and-forget ping that starts the backend spinning up while the user is
 * still typing, so the request that matters isn't the one paying the cold start.
 */
export function warmBackend() {
  API.get('/', { timeout: 120000 }).catch(() => { /* best effort */ })
}

export async function checkAccess(identifier: string) {
  const { data } = await API.post('/check-access', { identifier })
  return data as { access: boolean; message: string; name?: string }
}

export async function getVideoInfo(url: string, identifier: string) {
  const { data } = await API.post('/video-info', { url, identifier })
  return data as VideoInfo
}

export async function getDownloadUrl(url: string, formatId: string, identifier: string, ext: string) {
  const { data } = await API.get('/download', {
    params: { url, format_id: formatId, identifier, ext },
  })
  return data as { download_url: string; ext: string }
}

// Admin
export async function adminListUsers(secret: string, status?: string) {
  const { data } = await API.get('/admin/users', {
    headers: { 'x-admin-secret': secret },
    params: status ? { status } : {},
  })
  return data
}

export async function adminAddUser(secret: string, identifier: string, note?: string) {
  const { data } = await API.post('/admin/users', { identifier, note }, {
    headers: { 'x-admin-secret': secret },
  })
  return data
}

export async function adminUpdateStatus(secret: string, identifier: string, status: string) {
  const { data } = await API.patch('/admin/users/status', { identifier, status }, {
    headers: { 'x-admin-secret': secret },
  })
  return data
}

export async function adminDeleteUser(secret: string, identifier: string) {
  const { data } = await API.delete(`/admin/users/${encodeURIComponent(identifier)}`, {
    headers: { 'x-admin-secret': secret },
  })
  return data
}

export async function adminGetLogs(secret: string, limit = 50) {
  const { data } = await API.get('/admin/logs', {
    headers: { 'x-admin-secret': secret },
    params: { limit },
  })
  return data
}

export interface VideoFormat {
  type: 'video' | 'audio'
  format_id: string
  label: string
  icon: string
  resolution: string
  ext: string
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
  view_count?: number
  like_count?: number
  upload_date?: string
  id?: string
}