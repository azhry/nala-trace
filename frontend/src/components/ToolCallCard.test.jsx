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
    const { container } = render(<ToolCallCard event={shellEvent} />)
    const trigger = screen.getByRole('button', { name: /shell_command/ })
    const panel = container.querySelector('.tool-card-body')

    expect(container.querySelector('.tool-card-preview-label')).toHaveTextContent('Command')
    expect(container.querySelector('.tool-card-preview')).toHaveTextContent(/npm --prefix frontend test/)
    expect(container.querySelector('.tool-card-preview')).toHaveTextContent(/npm --prefix frontend run build/)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('data-closed')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('data-open')
    expect(panel.querySelector('pre')).toHaveTextContent(/"command": "npm --prefix frontend test/)
    expect(panel.querySelector('.response-block pre')).toHaveTextContent(/Tests passed\s+Build passed/)
  })

  it('labels a missing input without inventing a command', () => {
    const { container } = render(<ToolCallCard event={{ ...shellEvent, input: '' }} />)

    expect(container.querySelector('.tool-card-preview')).toHaveTextContent('Input not recorded')
    expect(container.querySelector('.tool-card-preview-label')).toHaveTextContent('Input')
    expect(container.querySelector('.tool-card')).toHaveAttribute('data-closed')
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
      },
    }} />)

    expect(screen.getByLabelText('Event token usage: 140 total tokens')).toHaveTextContent('140 tokens')
    expect(screen.getByText('recorded · record 42')).toBeInTheDocument()
  })

  it('does not render a usage label when the tool row has no recorded token usage', () => {
    render(<ToolCallCard event={shellEvent} />)

    expect(screen.queryByLabelText('Event token usage not recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('Usage not recorded')).not.toBeInTheDocument()
    expect(screen.queryByText(/0 tokens/)).not.toBeInTheDocument()
  })
})
