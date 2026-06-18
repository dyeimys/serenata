export type RsvpStatusFields = {
  attending?: boolean
  totalGuests: number
}

export function isRsvpConfirmed(submission: RsvpStatusFields) {
  return submission.attending !== false && submission.totalGuests > 0
}
