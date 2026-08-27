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

  it('shows recorded token usage in the tool row header', () => {
    render(<ToolCallCard event={{
      ...shellEvent,
      tokenUsage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningTokens: 5,
        totalTokens: 140,
        costUsd: 0.0012,
      },
    }} />)

    expect(screen.getByLabelText('Event token usage: 140 total tokens, $0.0012')).toHaveTextContent('140 tokens · $0.0012')
    expect(screen.getByText('recorded · record 42')).toBeInTheDocument()
  })

  it('does not render a usage label when the tool row has no recorded token usage', () => {
    render(<ToolCallCard event={shellEvent} />)

    expect(screen.queryByLabelText('Event token usage not recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('Usage not recorded')).not.toBeInTheDocument()
    expect(screen.queryByText(/0 tokens/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument()
  })

  it('keeps token counts but omits cost when the producer did not record a cost', () => {
    render(<ToolCallCard event={{
      ...shellEvent,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        costUsd: 0,
        costRecorded: false,
      },
    }} />)

    expect(screen.getByLabelText('Event token usage: 140 total tokens')).toHaveTextContent('140 tokens')
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument()
  })
})
