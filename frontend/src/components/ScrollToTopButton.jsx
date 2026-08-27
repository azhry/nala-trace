import { useEffect, useState } from 'react'

export const SCROLL_TO_TOP_THRESHOLD = 240

function isPastScrollThreshold() {
  return typeof window !== 'undefined' && window.scrollY > SCROLL_TO_TOP_THRESHOLD
}

function scrollToTop() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
}

export default function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(isPastScrollThreshold)

  useEffect(() => {
    const updateVisibility = () => setIsVisible(isPastScrollThreshold())
    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateVisibility)
  }, [])

  if (!isVisible) return null

  return <button type="button" className="scroll-to-top-button" aria-label="Scroll to top" title="Scroll to top" onClick={scrollToTop}><span aria-hidden="true">↑</span></button>
}
