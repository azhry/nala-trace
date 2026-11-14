import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { createAgent } from '@ui-sdk/react/agent'
import { expect, it } from 'vitest'
import { normalizeSessionSummaries } from '../sessionSummaries'
import SessionList from './SessionList'

const agent = createAgent()
const sessions = normalizeSessionSummaries({
  sessions: [
    {
      session_id: 'trace-session-a',
      title: 'Review the recorded run',
      first_event_at: '2026-11-12T08:00:00Z',
      last_event_at: '2026-11-12T08:05:00Z',
      event_count: 8,
      tool_call_count: 2,
      mcp_call_count: 1,
      skill_invocation_count: 0,
      file_operation_count: 1,
    },
  ],
})

function SessionListHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  return <SessionList sessions={sessions} selectedId={null} onSelect={() => {}} query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} sortBy={sortBy} onSortChange={setSortBy} onRetry={() => {}} />
}

it('exposes named session controls to the ui-sdk agent and applies their values', async () => {
  render(<SessionListHarness />)

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== 'more')
  const labels = components.map((entry) => entry.label)
  expect(labels).toContain('Search sessions')
  expect(labels).toContain('Filter sessions')
  expect(labels).toContain('Sort by')
  expect(components.filter((entry) => !entry.label).map(({ component, ref, actions }) => ({ component, ref, actions }))).toEqual([])

  const result = await agent.act({
    steps: [
      { ref: 'Search sessions', action: 'setValue', args: ['no matching record'] },
      { ref: 'Filter sessions', action: 'setValue', args: ['attention'] },
      { ref: 'Sort by', action: 'setValue', args: ['tools'] },
    ],
  })

  expect(result.ok, result.error?.message).toBe(true)
  expect(screen.getByText('No sessions match your search.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeInTheDocument()
})
