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

    const { result = false } = event.body
    const resultCode = result ? 'T' : 'F'

    const pool = getPool()
    await pool.execute('UPDATE intCard SET result = ? WHERE seqcardnum = ?', [resultCode, orderId])

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(update)
