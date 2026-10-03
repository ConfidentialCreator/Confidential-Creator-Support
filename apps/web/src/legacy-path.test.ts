import { describe, expect, it } from 'vitest'
import { legacyPath } from './legacy-path.ts'

const BASE = '/Confidential-Creator-Support/app/'

describe('legacyPath', () => {
  it('moves a v0.1.0 link from the site root under the app', () => {
    expect(legacyPath('/Confidential-Creator-Support/c/marrow-dispatch', BASE)).toBe(
      '/Confidential-Creator-Support/app/c/marrow-dispatch',
    )
    expect(legacyPath('/Confidential-Creator-Support/me', BASE)).toBe(
      '/Confidential-Creator-Support/app/me',
    )
  })

  it('leaves a path already under the app alone', () => {
    expect(legacyPath('/Confidential-Creator-Support/app/support/x', BASE)).toBeNull()
    expect(legacyPath('/Confidential-Creator-Support/app/', BASE)).toBeNull()
    expect(legacyPath('/Confidential-Creator-Support/app', BASE)).toBeNull()
  })

  it('does nothing when the app is not served from an /app/ folder', () => {
    expect(legacyPath('/c/marrow-dispatch', '/')).toBeNull()
    expect(
      legacyPath('/Confidential-Creator-Support/c/x', '/Confidential-Creator-Support/'),
    ).toBeNull()
  })

  it('works on a custom domain where the app lives at /app/', () => {
    expect(legacyPath('/c/marrow-dispatch', '/app/')).toBe('/app/c/marrow-dispatch')
  })

  it('ignores a path outside the site', () => {
    expect(legacyPath('/elsewhere/c/x', BASE)).toBeNull()
  })

  it('a look-alike prefix is not the app folder', () => {
    expect(legacyPath('/Confidential-Creator-Support/application', BASE)).toBe(
      '/Confidential-Creator-Support/app/application',
    )
  })
})
