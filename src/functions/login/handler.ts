import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { matchPassword } from '@libs/password'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'
import * as jwt from 'jsonwebtoken'

import schema from './schema'

const { JWT_SECRET } = process.env

const login: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined')
    const { userId, password } = event.body

    const pool = getPool()
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT userid, password FROM member WHERE userid = ?', [userId])

    if (rows.length === 0) {
      return formatJSONResponse({ statusCode: 400, message: 'user not found' })
    }

    const matched = await matchPassword(password, rows[0].password)

    if (!matched) {
      return formatJSONResponse({ statusCode: 401, message: 'Unauthorized' })
    }

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1d' })

    return formatJSONResponse({ message: token })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(login)
