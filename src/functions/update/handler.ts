import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'

import schema from './schema'

const update: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const orderId = event.pathParameters?.orderId
    if (!orderId) return formatJSONResponse({ statusCode: 400, message: 'orderId is required' })

    const { status } = event.body

    const pool = getPool()
    await pool.execute('UPDATE offerings SET status = ? WHERE order_id = ?', [status, orderId])

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(update)
