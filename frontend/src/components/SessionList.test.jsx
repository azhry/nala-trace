import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SessionList from './SessionList'
import { normalizeSessionSummaries } from '../sessionSummaries'

const sessions = normalizeSessionSummaries({
  sessions: [
    {
      session_id: 'session-a',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 10,
      tool_call_count: 2,
      skill_invocation_count: 1,
      file_operation_count: 2,
    },
    {
      session_id: 'session-b',
      first_event_at: '2026-08-19T08:00:00Z',
      last_event_at: '2026-08-19T08:05:00Z',
      event_count: 30,
      tool_call_count: 8,
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
  it('renders representative summaries with accessible operation badges', () => {
    renderList()

    expect(screen.getByRole('button', { name: 'Open session session-a' })).toBeInTheDocument()
    expect(screen.getByLabelText('8 tools')).toBeInTheDocument()
    expect(screen.getByLabelText('5 files')).toBeInTheDocument()
    expect(screen.getByLabelText('1 skills')).toBeInTheDocument()
  })

  it('renders stable recency and metric ordering controls', () => {
    const onSortChange = vi.fn()
    renderList({ onSortChange })

    expect(recordIds()).toEqual(['session-b', 'session-a'])
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
    expect(screen.getByRole('button', { name: 'Open session session-b' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<SessionList sessions={sessions} selectedId="session-b" onSelect={vi.fn()} query="missing" onQueryChange={onQueryChange} filter="all" onFilterChange={vi.fn()} sortBy="recent" onSortChange={vi.fn()} />)
    expect(screen.getByText('No sessions match your filters.')).toBeInTheDocument()
  })
})
