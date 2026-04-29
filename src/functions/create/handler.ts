import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'
import { encrypt } from '@libs/crypto'

import schema from './schema'

const create: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const { pay_type, name, jumin1, jumin2, email, tithe, thanks, building, mission, relief, order_id } = event.body

    const amount = (tithe ?? 0) + (thanks ?? 0) + (building ?? 0) + (mission ?? 0) + (relief ?? 0)
    if (amount <= 0) return formatJSONResponse({ statusCode: 400, message: 'amount must be greater than 0' })

    const pool = getPool()
    await pool.execute(
      `INSERT INTO offerings (pay_type, name, jumin1, jumin2, email, tithe, thanks, building, mission, relief, amount, order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pay_type,
        name,
        jumin1,
        encrypt(jumin2),
        email ?? null,
        tithe ?? 0,
        thanks ?? 0,
        building ?? 0,
        mission ?? 0,
        relief ?? 0,
        amount,
        order_id,
      ]
    )

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(create)
