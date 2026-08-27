import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrollToTopButton, { SCROLL_TO_TOP_THRESHOLD } from './ScrollToTopButton'

const originalMatchMedia = window.matchMedia
const originalScrollTo = window.scrollTo

function setScrollY(value) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value })
}

describe('ScrollToTopButton', () => {
  beforeEach(() => {
    setScrollY(0)
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    setScrollY(0)
    window.matchMedia = originalMatchMedia
    window.scrollTo = originalScrollTo
    vi.restoreAllMocks()
  })

  it('stays hidden near the top and appears after scrolling down', () => {
    render(<ScrollToTopButton />)

    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument()

    setScrollY(SCROLL_TO_TOP_THRESHOLD + 1)
    fireEvent.scroll(window)

    expect(screen.getByRole('button', { name: 'Scroll to top' })).toHaveAttribute('title', 'Scroll to top')

    setScrollY(0)
    fireEvent.scroll(window)

    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument()
  })

  it('scrolls smoothly to the top and uses instant scrolling for reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    setScrollY(SCROLL_TO_TOP_THRESHOLD + 1)
    render(<ScrollToTopButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top' }))
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' })

    window.matchMedia.mockReturnValue({ matches: true })
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top' }))
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })
})
