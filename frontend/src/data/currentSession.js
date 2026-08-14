import { currentSessionEvents } from './currentSessionEvents'

// Metadata and the complete sanitized event timeline for the current Codex rollout.
// Tool inputs/outputs are clipped and credential-like values are redacted before they
// reach the browser. The rendered timeline contains every audited user/assistant turn,
// tool call, tool output pairing, context event, and compaction marker.
export const currentSession = {
  id: '019fff58-a4f9-7c73-a83e-95ed8fd361a7',
  title: 'Current Codex session',
  status: 'attention',
  capturedAt: '13:40:28',
  startedAt: '08:17:08',
  duration: '05h 23m',
  events: 1408,
  renderedRows: currentSessionEvents.length,
  rawEvents: 3737,
  transcriptChunks: 1467,
  toolCalls: 602,
  renderedToolRows: 623,
  messages: 112,
  userTurns: 12,
  skills: 5,
  skillDocumentsRead: 10,
  skillTaggedOperations: 501,
  inferredSkills: 7,
  files: 156,
  latestTool: 'shell_command',
  latestTime: '13:40:16',
  outcome: 'Needs review',
  outcomeNote: 'The UI direction was rejected and needs another pass',
  insights: {
    evalPasses: null,
    evalTotal: null,
    judgeAlignment: null,
    reviewSignal: 'Needs review',
    metrics: [
      { label: 'Semantic records', value: '1,408', detail: 'complete audited session timeline' },
      { label: 'Tool calls', value: '602', detail: 'real Codex operations captured' },
      { label: 'Rendered rows', value: currentSessionEvents.length.toLocaleString(), detail: 'turns, tools, outputs, and context events' },
    ],
  },
  eventsList: currentSessionEvents,
}

export const currentSessions = [currentSession]
