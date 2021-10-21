export const trimLeading0x = (input: string) => (input.startsWith('0x') ? input.slice(2) : input)

export const ensureLeading0x = (input: string) => (input.startsWith('0x') ? input : `0x${input}`)
