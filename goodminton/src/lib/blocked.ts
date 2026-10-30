/** Work Google accounts can't use the app: people sign in with their personal one. */
const BLOCKED_DOMAINS = ['careem.com']

export const isBlockedEmail = (email?: string | null) =>
  !!email && BLOCKED_DOMAINS.some(d => email.toLowerCase().endsWith('@' + d))

export const BLOCKED_REASON = 'Please sign in with your personal Google account, not your Careem work account.'
