import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ToolCallCard from './ToolCallCard'

const shellEvent = {
  index: '007',
  tool: 'shell_command',
  time: 'Aug 19, 2026, 8:00 AM',
  duration: '0.42s',
  intent: 'Captured tool call',
  action: 'call',
  status: 'recorded',
  record: '42',
  input: JSON.stringify({
    command: 'npm --prefix frontend test\nnpm --prefix frontend run build',
    workdir: 'C:\\workspace',
  }, null, 2),
  response: 'Tests passed\nBuild passed',
  responseLabel: 'text',
  skills: [],
  files: [],
}

describe('ToolCallCard', () => {
  it('shows a recorded multiline shell command while collapsed and keeps full evidence after expanding', () => {
    render(<ToolCallCard event={shellEvent} />)

    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText(/npm --prefix frontend test/)).toBeInTheDocument()
    expect(screen.getByText(/npm --prefix frontend run build/)).toBeInTheDocument()
    expect(screen.queryByText('Tests passed\nBuild passed')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /shell_command/ }))

    expect(screen.getByText(/"command": "npm --prefix frontend test/)).toBeInTheDocument()
    expect(screen.getByText('tool_response').parentElement.parentElement.querySelector('pre')).toHaveTextContent(/Tests passed\s+Build passed/)
  })

  it('labels a missing input without inventing a command', () => {
    render(<ToolCallCard event={{ ...shellEvent, input: '' }} />)

    expect(screen.getByText('Input not recorded')).toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
  })
})
