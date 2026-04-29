import { getPool } from '@libs/db'
import type { ResultSetHeader } from 'mysql2'

export interface CompletePayload {
  paymentKey: string
  orderId: string
  method: string | null
  rawResponse: unknown
}

export async function completeOffering(payload: CompletePayload): Promise<void> {
  const { paymentKey, orderId, method, rawResponse } = payload
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT IGNORE INTO payments (order_id, payment_key, method, status, raw_response)
       VALUES (?, ?, ?, 'DONE', ?)`,
      [orderId, paymentKey, method ?? null, JSON.stringify(rawResponse)]
    )

    // 최초 INSERT일 때만 offerings 상태 변경 (중복 호출 방어)
    if (result.affectedRows > 0) {
      await conn.execute(
        `UPDATE offerings SET status = 'COMPLETED' WHERE order_id = ? AND status IN ('PENDING', 'PROCESSING')`,
        [orderId]
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
