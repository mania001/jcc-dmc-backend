import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { hashPassword } from '@libs/password'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'

import schema from './schema'

const signup: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const { userId, password } = event.body

    const pool = getPool()
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT userId FROM member WHERE userId = ?', [userId])

    if (rows.length > 0) {
      return formatJSONResponse({
        statusCode: 400,
        message: 'A user with that username already exists.',
      })
    }

    const hash = await hashPassword(password)
    await pool.execute('INSERT INTO member (userId, password) VALUES (?, ?)', [userId, hash])

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(signup)
