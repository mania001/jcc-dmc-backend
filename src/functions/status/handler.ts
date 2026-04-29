import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'

const status: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const orderId = event.pathParameters?.orderId
    if (!orderId) return formatJSONResponse({ statusCode: 400, message: 'orderId is required' })

    const pool = getPool()
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT status FROM offerings WHERE order_id = ?', [orderId])

    if (rows.length === 0) return formatJSONResponse({ statusCode: 404, message: 'not found' })

    return formatJSONResponse({ status: rows[0].status })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(status)
