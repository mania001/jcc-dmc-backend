import { getPool } from '@libs/db'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'

export interface CompletePayload {
  paymentKey: string
  orderId: string
  method: string | null
  rawResponse: unknown
}

export async function completeOffering(payload: CompletePayload): Promise<void> {
  const { paymentKey, orderId, method, rawResponse } = payload
  const { status: tossStatus, totalAmount } = (rawResponse ?? {}) as { status?: unknown; totalAmount?: unknown }

  // 결제 미완료 상태(가상계좌 입금 대기 등)는 기록하지 않고 건너뜀 → 이후 DONE 웹훅에서 완료 처리
  if (typeof tossStatus === 'string' && tossStatus !== 'DONE') {
    console.warn('Payment not DONE, skipped', { orderId, tossStatus })
    return
  }

  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    // 주문 행을 먼저 잠가 같은 주문에 대한 완료 처리를 직렬화 (confirm/웹훅 동시 도착 시 데드락 방지)
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT amount FROM offerings WHERE order_id = ? FOR UPDATE`, [
      orderId,
    ])
    const expected = rows.length > 0 ? Number(rows[0].amount) : null

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT IGNORE INTO payments (order_id, payment_key, method, status, raw_response)
       VALUES (?, ?, ?, 'DONE', ?)`,
      [orderId, paymentKey, method ?? null, JSON.stringify(rawResponse ?? null)]
    )

    // 최초 INSERT일 때만 offerings 상태/결제수단 변경 (중복 호출 방어)
    // FAILED도 대상에 포함: 실패 보고가 먼저 처리된 뒤 실제 결제가 완료된 경우를 살림 (CANCELED는 제외)
    if (result.affectedRows > 0) {
      // Toss 실결제 금액이 신청 금액과 명확히 다를 때만 실패 처리 (금액 정보가 없으면 기존대로 완료)
      if (typeof totalAmount === 'number' && expected !== null && totalAmount !== expected) {
        console.error('Payment amount mismatch', { orderId, paymentKey, expected, totalAmount })
        await conn.execute(
          `UPDATE offerings SET status = 'FAILED', fail_reason = 'AMOUNT_MISMATCH', pay_type = ? WHERE order_id = ? AND status IN ('PENDING', 'PROCESSING', 'FAILED')`,
          [method ?? null, orderId]
        )
      } else {
        await conn.execute(
          `UPDATE offerings SET status = 'COMPLETED', fail_reason = NULL, pay_type = ? WHERE order_id = ? AND status IN ('PENDING', 'PROCESSING', 'FAILED')`,
          [method ?? null, orderId]
        )
      }
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
