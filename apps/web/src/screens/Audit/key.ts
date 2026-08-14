import { AUDIT_KEY } from '../../mockData.ts'

export const keyFits = (input: string) => input.trim() === AUDIT_KEY
