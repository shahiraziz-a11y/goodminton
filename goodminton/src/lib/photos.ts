/** Badminton photos (from the design, Unsplash licence). Each match or group always gets the same one. */
export const PHOTOS = [1, 2, 3, 4, 5].map(n => `/photos/court-${n}.webp`)

export function photoFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PHOTOS[h % PHOTOS.length]
}

/** Group tiles have their own illustrated art (colour + badminton motif), so they don't look like matches. */
export const GROUP_ART = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `/groups/art-${n}.svg`)

export function groupArtFor(id: string) {
  // FNV-1a with a final mix, so similar ids still spread across all the art.
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13
  return GROUP_ART[(h >>> 0) % GROUP_ART.length]
}
