import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'

describe('Nala Trace review workspace', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    window.location.hash = ''
  })

  it('explains the review workflow and renders its three core surfaces', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /understand the run, not just the result/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /review traces/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: /session records/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /conversation & tool timeline/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /quality signals/i })).toBeInTheDocument()
  })

  it('filters sessions and updates the selected trace detail', () => {
    render(<App />)

    fireEvent.change(screen.getByPlaceholderText(/search by title/i), { target: { value: 'proxy' } })
    expect(screen.queryByRole('button', { name: /build the react shell/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /trace proxy failure/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }))
    fireEvent.click(screen.getByRole('button', { name: /review auth boundary/i }))
    expect(screen.getByRole('button', { name: /review auth boundary/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('linear_get_issue')).toHaveLength(2)
  })

  it('expands tool calls and changes navigation destinations', () => {
    render(<App />)

    const toolToggle = screen.getByRole('button', { name: /apply_patch/i })
    expect(toolToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toolToggle)
    expect(toolToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toolToggle)
    expect(screen.getByText('tool_input')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /measure quality/i }))
    expect(screen.getByRole('heading', { name: /evaluation workspace/i })).toBeInTheDocument()
    expect(screen.getByText(/sample eval pass rate/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reference set/i }))
    expect(screen.getByRole('heading', { name: /trusted trace reference set/i })).toBeInTheDocument()
  })
})
