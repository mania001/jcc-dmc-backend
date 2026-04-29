import type { SQSEvent } from 'aws-lambda'
import { getPool } from '@libs/db'

interface OfferingUpdatePayload {
  paymentKey: string
  orderId: string
  amount: number
  method: string | null
  rawResponse: unknown
}

export const main = async (event: SQSEvent, context: { callbackWaitsForEmptyEventLoop: boolean }): Promise<void> => {
  context.callbackWaitsForEmptyEventLoop = false
  const pool = getPool()

  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as OfferingUpdatePayload
    const { paymentKey, orderId, method, rawResponse } = payload

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      await conn.execute(
        `INSERT IGNORE INTO payments (order_id, payment_key, method, status, raw_response)
         VALUES (?, ?, ?, 'DONE', ?)`,
        [orderId, paymentKey, method ?? null, JSON.stringify(rawResponse)]
      )

      await conn.execute(`UPDATE offerings SET status = 'COMPLETED' WHERE order_id = ? AND status != 'COMPLETED'`, [
        orderId,
      ])

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }
}
