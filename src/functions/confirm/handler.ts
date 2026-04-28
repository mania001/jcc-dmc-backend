import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'

import schema from './schema'

const { TOSS_SECRET_KEY } = process.env

const confirm: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not defined')

    const { paymentKey, orderId, amount } = event.body

    const pool = getPool()

    // 1. orderId 존재 여부 + 미처리 상태 확인
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT order_id, price1, price2, price3, price4, price5 FROM payment WHERE order_id = ? AND result = 'F'",
      [orderId]
    )

    if (rows.length === 0) {
      return formatJSONResponse({ statusCode: 404, message: 'payment not found or already processed' })
    }

    // 2. 금액 검증
    const row = rows[0]
    const totalAmount =
      Number(row.price1 ?? 0) +
      Number(row.price2 ?? 0) +
      Number(row.price3 ?? 0) +
      Number(row.price4 ?? 0) +
      Number(row.price5 ?? 0)

    if (totalAmount !== amount) {
      return formatJSONResponse({ statusCode: 400, message: 'amount mismatch' })
    }

    // 3. TossPay 결제 승인 API 호출
    const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')
    const tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })

    if (!tossResponse.ok) {
      const errorBody = (await tossResponse.json()) as { message?: string; code?: string }
      return formatJSONResponse({
        statusCode: tossResponse.status,
        message: errorBody.message ?? 'TossPay confirm failed',
        code: errorBody.code,
      })
    }

    // 4. DB 승인 처리
    await pool.execute('UPDATE payment SET result = ?, payment_key = ? WHERE order_id = ?', ['T', paymentKey, orderId])

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(confirm)
