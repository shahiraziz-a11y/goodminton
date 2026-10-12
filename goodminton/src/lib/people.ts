const COLORS = ['#1E5C3A', '#B4462F', '#3B5BA9', '#8A5A12', '#6B3FA0', '#0F6E73', '#9C2F5E', '#4A5A1E', '#A0461E']

/** Stable avatar colour per user. */
export function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

export type Person = { id: string; name: string; first: string; initials: string; color: string }

export function person(id: string, name: string): Person {
  return { id, name, first: firstName(name), initials: initials(name), color: colorFor(id) }
}
