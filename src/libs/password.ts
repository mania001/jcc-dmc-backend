import * as bcrypt from 'bcryptjs'

const saltRounds = 10

export const hashPassword = async (password: string) => {
  return bcrypt.hash(password, saltRounds)
}

export const matchPassword = async (password: string, hash: string) => {
  return bcrypt.compare(password, hash)
}
