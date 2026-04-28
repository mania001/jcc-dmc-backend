import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'

import schema from './schema'

const create: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const { pay_type, name, jumin1, jumin2, email, price1, price2, price3, price4, price5, contents, order_id } =
      event.body

    const pool = getPool()
    await pool.execute(
      'INSERT INTO payment (pay_type, name, jumin1, jumin2, email, price1, price2, price3, price4, price5, contents, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        pay_type,
        name,
        jumin1 ?? null,
        jumin2 ?? null,
        email ?? null,
        price1 ?? null,
        price2 ?? null,
        price3 ?? null,
        price4 ?? null,
        price5 ?? null,
        contents ?? null,
        order_id,
      ]
    )

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(create)
