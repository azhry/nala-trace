import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SessionList from './SessionList'
import { normalizeSessionSummaries } from '../sessionSummaries'

const sessions = normalizeSessionSummaries({
  sessions: [
    {
      session_id: 'session-a',
      title: 'Review the session title',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 10,
      tool_call_count: 2,
      mcp_call_count: 3,
      mcp_servers: ['github', 'linear'],
      skill_invocation_count: 1,
      file_operation_count: 2,
    },
    {
      session_id: 'session-b',
      title: 'Investigate the flagged session',
      first_event_at: '2026-08-19T08:00:00Z',
      last_event_at: '2026-08-19T08:05:00Z',
      event_count: 30,
      tool_call_count: 8,
      mcp_call_count: 0,
      mcp_servers: [],
      skill_invocation_count: 0,
      file_operation_count: 5,
      evaluation_status: 'attention',
    },
  ],
})

function renderList(overrides = {}) {
  const props = {
    sessions,
    selectedId: 'session-a',
    onSelect: vi.fn(),
    query: '',
    onQueryChange: vi.fn(),
    filter: 'all',
    onFilterChange: vi.fn(),
    sortBy: 'recent',
    onSortChange: vi.fn(),
    ...overrides,
  }
  return render(<SessionList {...props} />)
}

function recordIds() {
  return [...document.querySelectorAll('.session-record-main strong')].map((node) => node.textContent)
}

describe('SessionList', () => {
  it('renders titles as primary labels and IDs as row metadata', () => {
    renderList()

    expect(screen.getByText('Review the session title')).toBeInTheDocument()
    expect(screen.getByText('session-a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open session Review the session title (session-a)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open session Review the session title (session-a)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('8 tools')).toBeInTheDocument()
    expect(screen.getByLabelText('3 MCP calls')).toBeInTheDocument()
    expect(screen.getByLabelText('5 files')).toBeInTheDocument()
    expect(screen.getByLabelText('1 skills')).toBeInTheDocument()
    expect(screen.getByText('MCP servers: github · linear')).toBeInTheDocument()
    expect(screen.getByText('MCP servers: none recorded')).toBeInTheDocument()
  })

  it('renders stable recency and metric ordering controls', () => {
    const onSortChange = vi.fn()
    renderList({ onSortChange })

    expect(recordIds()).toEqual(['Investigate the flagged session', 'Review the session title'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort sessions' }), { target: { value: 'tools' } })
    expect(onSortChange).toHaveBeenCalledWith('tools')
  })

  it('preserves selection while filters change and reports no matches', () => {
    const onQueryChange = vi.fn()
    const { rerender } = renderList({ onQueryChange })
    const search = screen.getByRole('textbox', { name: 'Search sessions' })

    fireEvent.change(search, { target: { value: 'files 5' } })
    expect(onQueryChange).toHaveBeenCalledWith('files 5')
    rerender(<SessionList sessions={sessions} selectedId="session-b" onSelect={vi.fn()} query="files 5" onQueryChange={onQueryChange} filter="all" onFilterChange={vi.fn()} sortBy="recent" onSortChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Open session Investigate the flagged session (session-b)' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<SessionList sessions={sessions} selectedId="session-b" onSelect={vi.fn()} query="missing" onQueryChange={onQueryChange} filter="all" onFilterChange={vi.fn()} sortBy="recent" onSortChange={vi.fn()} />)
    expect(screen.getByText('No sessions match your filters.')).toBeInTheDocument()
  })

  it('keeps legacy summaries without a title readable and navigable by ID', () => {
    const legacySessions = normalizeSessionSummaries({
      sessions: [{ session_id: 'legacy-session', event_count: 1 }],
    })
    const onSelect = vi.fn()

    renderList({ sessions: legacySessions, selectedId: null, onSelect })

    const row = screen.getByRole('button', { name: 'Open session legacy-session' })
    expect(row).toBeInTheDocument()
    expect(screen.getAllByText('legacy-session')).toHaveLength(2)
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('legacy-session')
  })
})
