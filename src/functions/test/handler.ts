import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'

const test: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const id = event.pathParameters?.id
    if (!id) return formatJSONResponse({ statusCode: 400, message: 'id is required' })

    const pool = getPool()
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM intCard WHERE num = ?', [id])

    return formatJSONResponse({ message: rows })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(test)
