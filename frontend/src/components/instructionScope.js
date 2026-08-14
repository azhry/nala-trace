export const instructionFilePattern = /agents|AGENTS\.md|SKILL\.md|TOOLING\.md|CONTEXT\.md|workflow/i

const localProjectPrefixes = [
  'agents.md',
  '.agents/config.md',
  '.agents/knowledge',
  '.agents/templates',
  '.agents/workflows',
  '.agents/skills/codex-session-audit',
  '.agents/skills/github',
  '.agents/skills/kilocode-session-audit',
  '.agents/skills/linear',
  '.github/workflows',
]

// The audit export strips the user's home/project root from file paths. These
// global skills were resolved from the user-level skills directory in the
// captured source environment, not from this repository's .agents directory.
const globalRelativePrefixes = [
  '.agents/skills/browser-use',
  '.agents/skills/diagnose',
  '.agents/skills/frontend-design',
]

export function normalizePath(file) {
  return String(file).replaceAll('\\', '/').replaceAll('//', '/').replace(/(\.md|\.ps1|\.yml)\/n$/i, '$1')
}

export function isInstructionFile(file) {
  return instructionFilePattern.test(file)
}

function startsWithPath(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function getInstructionScope(file) {
  const path = normalizePath(file)
  const lowerPath = path.toLowerCase()
  const relativePath = lowerPath.replace(/^\.\//, '')

  if (localProjectPrefixes.some((prefix) => startsWithPath(relativePath, prefix))) {
    return { kind: 'project', label: 'Local project instruction', shortLabel: 'Local project' }
  }

  if (globalRelativePrefixes.some((prefix) => startsWithPath(relativePath, prefix))) {
    return { kind: 'global', label: 'Global instruction', shortLabel: 'Global' }
  }

  if (/(^|\/)nala-trace\/(?:\.agents|agents\.md|\.github\/workflows)(?:\/|$)/i.test(lowerPath)) {
    return { kind: 'project', label: 'Local project instruction', shortLabel: 'Local project' }
  }

  if (/(^|\/)(?:\.agents|\.codex\/skills)\//i.test(lowerPath)) {
    return { kind: 'global', label: 'Global instruction', shortLabel: 'Global' }
  }

  return { kind: 'unknown', label: 'Instruction scope not recorded', shortLabel: 'Scope unknown' }
}
