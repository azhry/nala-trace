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
    expect(screen.getByText(/local Go service/)).toBeInTheDocument()
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

  it('filters sessions and updates the selected trace detail', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /needs review/i }))
    expect(screen.queryByRole('button', { name: /build the react shell/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /trace proxy failure/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('link', { name: /sessions/i }))
    fireEvent.click(screen.getByRole('button', { name: /all traces/i }))
    fireEvent.click(screen.getByRole('button', { name: /review auth boundary/i }))
    expect(screen.getByRole('heading', { name: /review auth boundary/i })).toBeInTheDocument()
    expect(screen.getByText('linear_get_issue')).toBeInTheDocument()
  })

  it('makes eval range and golden-set filters observable', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: /evals/i }))
    fireEvent.click(screen.getByRole('button', { name: /baseline/i }))
    expect(screen.getByText('89.8')).toBeInTheDocument()
    expect(screen.getByText(/baseline 120 sessions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: /golden set/i }))
    fireEvent.click(screen.getByRole('button', { name: /^security$/i }))
    expect(screen.getByRole('button', { name: /keeps secrets out of the client/i })).toBeInTheDocument()
    expect(screen.getByText('Selected: gold_014')).toBeInTheDocument()
  })
})
