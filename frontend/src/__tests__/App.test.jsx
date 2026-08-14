import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'

describe('Nala Trace session workspace', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    window.location.hash = ''
  })

  it('renders the session list as the primary page', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /all captured sessions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sessions every captured run/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: /session records/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /current codex session/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /evaluation workspace/i })).not.toBeInTheDocument()
  })

  it('opens the selected session detail with real conversation and trace rows', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /current codex session/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /current codex session/i })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /session detail/i })).toBeInTheDocument()
    expect(screen.getByText('/goal do task from task AZH-449 to AZH-455')).toBeInTheDocument()
    expect(screen.getAllByText(/linear_get_issue/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not recorded')).toHaveLength(2)
  })

  it('filters the detail stream and expands recorded tool input and response', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /current codex session/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /current codex session/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /^tool calls$/i }))
    expect(screen.queryByText('/goal do task from task AZH-449 to AZH-455')).not.toBeInTheDocument()
    expect(screen.getByText('tool_input')).toBeInTheDocument()
    expect(screen.getByText('tool_response')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sessions every captured run/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /all captured sessions/i })).toBeInTheDocument())
  })
})
