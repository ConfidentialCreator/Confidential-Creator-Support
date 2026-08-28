import { handleSchema } from '@ccsupport/shared'
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type ProgramDerivedAddress,
} from '@solana/kit'
import { CCSUPPORT_PROGRAM_ADDRESS } from './generated/index.ts'

const utf8 = getUtf8Encoder()
const addressBytes = getAddressEncoder()

type Seeds = Parameters<typeof getProgramDerivedAddress>[0]['seeds']

const derive = (seeds: Seeds): Promise<ProgramDerivedAddress> =>
  getProgramDerivedAddress({ programAddress: CCSUPPORT_PROGRAM_ADDRESS, seeds })

export const configPda = (): Promise<ProgramDerivedAddress> => derive([utf8.encode('config')])

export const creatorPda = (wallet: Address): Promise<ProgramDerivedAddress> =>
  derive([utf8.encode('creator'), addressBytes.encode(wallet)])

// Seed — сирі байти рядка. Невалідний handle програма відхиляє (6001), тож
// клієнт для нього адресу не виводить узагалі.
export const handlePda = async (handle: string): Promise<ProgramDerivedAddress> =>
  derive([utf8.encode('handle'), utf8.encode(handleSchema.parse(handle))])

export const pledgePda = (
  creatorWallet: Address,
  supporter: Address,
): Promise<ProgramDerivedAddress> =>
  derive([
    utf8.encode('pledge'),
    addressBytes.encode(creatorWallet),
    addressBytes.encode(supporter),
  ])
