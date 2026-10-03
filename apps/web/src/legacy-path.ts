const APP_DIR = 'app/'

// Until v0.2.0 the app sat at the site root; links shared then (`/c/:handle`, `/support/:handle`)
// now reach the root 404 page, which is this app's shell. Rewriting them under the app's base
// before the router starts keeps them working without a reload.
export function legacyPath(pathname: string, appBase: string): string | null {
  if (!appBase.endsWith(`/${APP_DIR}`)) return null
  if (pathname.startsWith(appBase) || `${pathname}/` === appBase) return null
  const siteRoot = appBase.slice(0, -APP_DIR.length)
  if (!pathname.startsWith(siteRoot)) return null
  return appBase + pathname.slice(siteRoot.length)
}
