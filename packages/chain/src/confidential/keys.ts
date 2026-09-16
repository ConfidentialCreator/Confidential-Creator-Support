import {
  type Address,
  createSignableMessage,
  getAddressEncoder,
  isMessageModifyingSigner,
  type MessageSigner,
  type SignatureBytes,
} from '@solana/kit'
import { ConfidentialKeys } from '@solana/zk-sdk'

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

// One derivation per (owner, mint): a signature over the canonical `solana-conf-bal/v1 || owner || mint`.
// The secrets live only in the returned object — no serialisation.
export async function deriveConfidentialKeys(
  signer: MessageSigner,
  owner: Address,
  mint: Address,
): Promise<ConfidentialKeys> {
  if (signer.address !== owner) {
    throw new Error(`signer ${signer.address} cannot derive keys for owner ${owner}`)
  }
  const encode = getAddressEncoder()
  const seed = new Uint8Array(64)
  seed.set(encode.encode(owner), 0)
  seed.set(encode.encode(mint), 32)
  const message = createSignableMessage(ConfidentialKeys.signerMessage(seed))

  let signature: SignatureBytes | undefined
  if (isMessageModifyingSigner(signer)) {
    const [signed] = await signer.modifyAndSignMessages([message])
    // A signature over altered text would tie the keys to one wallet's prefixing
    // scheme, and another wallet with the same key could not read the balance.
    if (!signed || !bytesEqual(signed.content, message.content)) {
      throw new Error('wallet altered the key-derivation message; keys would not be portable')
    }
    signature = signed.signatures[owner]
  } else {
    const [dictionary] = await signer.signMessages([message])
    signature = dictionary?.[owner]
  }
  if (!signature) {
    throw new Error('wallet returned no signature for the key-derivation message')
  }
  return ConfidentialKeys.fromSignature(new Uint8Array(signature))
}
