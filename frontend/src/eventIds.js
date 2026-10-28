export function normalizeCapturedEventId(value) {
  if (typeof value !== 'string') return ''
  let eventId = value.trim()
  const wrappedId = eventId.match(/^ObjectId\s*\(\s*(?:(['"])(.*?)\1|([a-f\d]{24}))\s*\)$/i)
  if (wrappedId) eventId = (wrappedId[2] ?? wrappedId[3]).trim()
  return /^[a-f\d]{24}$/i.test(eventId) ? eventId.toLowerCase() : eventId
}
