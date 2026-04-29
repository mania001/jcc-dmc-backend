import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32
const IV_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not defined')
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== KEY_LENGTH) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return buf
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encrypted: string): string {
  const [ivHex, dataHex] = encrypted.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
