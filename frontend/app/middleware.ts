import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.get('auth_token') // or whatever you store on login

  if (!isLoggedIn && request.nextUrl.pathname.startsWith('/download')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/download/:path*'],
}