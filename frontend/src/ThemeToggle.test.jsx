import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemeToggle from './ThemeToggle'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Nala appearance preference', () => {
  it('changes the rendered theme with the keyboard and preserves the choice on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ThemeToggle />)
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('nala-ui-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true')
    unmount()
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('follows system changes until an explicit preference is selected', async () => {
    let dark = true
    let listener
    vi.stubGlobal('matchMedia', () => ({
      matches: dark,
      addEventListener: (_event, callback) => { listener = callback },
      removeEventListener: vi.fn(),
    }))
    const user = userEvent.setup()
    render(<ThemeToggle />)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    dark = true
    listener()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('keeps the control usable when preference storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeEnabled()
  })
})
