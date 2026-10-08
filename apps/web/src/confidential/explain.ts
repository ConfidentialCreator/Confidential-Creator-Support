// The key-derivation message is binary (`solana-conf-bal/v1 || owner || mint`), so wallets
// either refuse it or warn about it. Both reactions are about the format, not the user, and
// the wallet's own words do not say what to do next.

// Phantom rejects any binary message as a possible transaction, before showing a prompt.
const BINARY_REFUSAL = /cannot sign solana transactions using sign message/i

export const BINARY_REFUSAL_TEXT =
  'This wallet refuses to sign the key message because it is binary. Use Solflare with this account: any wallet that holds it derives the same keys.'

export function explainKeyFailure(error: Error): Error {
  return BINARY_REFUSAL.test(error.message)
    ? new Error(BINARY_REFUSAL_TEXT, { cause: error })
    : error
}

// Shown next to every button that asks for the key signature: Solflare labels the message
// "unreadable" and warns it "may hide a transaction".
export const KEY_MESSAGE_HINT =
  'The wallet may call this message unreadable: it is the seed of your keys, not a transaction, and it moves no funds.'
