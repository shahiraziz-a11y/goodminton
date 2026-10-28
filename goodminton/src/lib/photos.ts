/** Badminton photos (from the design, Unsplash licence). Each match or group always gets the same one. */
export const PHOTOS = [1, 2, 3, 4, 5].map(n => `/photos/court-${n}.webp`)

export function photoFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PHOTOS[h % PHOTOS.length]
}
