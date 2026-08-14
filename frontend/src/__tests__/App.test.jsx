import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'

describe('Nala Trace shell', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    window.location.hash = ''
  })

  it('renders the root workspace and its three navigation destinations', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /read the trace before the failure/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sessions/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /evals/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /golden set/i })).toBeInTheDocument()
    expect(screen.getByText('/api → local Go service')).toBeInTheDocument()
  })

  it('changes the visible workspace when navigation links are selected', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: /evals/i }))
    expect(screen.getByRole('heading', { name: /measure what good looks like/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /evals/i })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('link', { name: /golden set/i }))
    expect(screen.getByRole('heading', { name: /keep the reference close/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /the examples worth protecting/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /golden set/i })).toHaveAttribute('aria-current', 'page')
  })
})
