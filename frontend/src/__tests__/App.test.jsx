import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import TraceView from '../components/TraceView'

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

  it('filters the detail stream and expands recorded tool input and response', () => {
    render(<TraceView session={{ id: 'session-test', events: 3, messages: 1, userTurns: 1, toolCalls: 1, startedAt: '08:00:00', capturedAt: '08:01:00', rawEvents: 3, eventsList: [
      { id: 'user-1', type: 'user', role: 'user', time: '08:00:01', record: 1, body: '/inspect this session' },
      { id: 'tool-1', type: 'tool', index: '001', record: 2, time: '08:00:02', tool: 'shell_command', intent: 'Read frontend files', action: 'read', duration: 'recorded', status: 'success', skills: ['frontend-design'], files: ['frontend/src/App.jsx'], input: 'Get-Content frontend/src/App.jsx', responseLabel: 'output', response: 'App.jsx read.' },
    ] }} />)

    fireEvent.click(screen.getByRole('button', { name: /^tool calls$/i }))
    expect(screen.queryByText('/inspect this session')).not.toBeInTheDocument()
    expect(screen.getByText('tool_input')).toBeInTheDocument()
    expect(screen.getByText('tool_response')).toBeInTheDocument()
    expect(screen.getByText('Skill invocations')).toBeInTheDocument()
    expect(screen.getByText('1 invocations · 1 unique skills')).toBeInTheDocument()
    expect(screen.getAllByText('skill / frontend-design')).toHaveLength(2)
  })
})
