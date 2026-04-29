import type { SQSEvent } from 'aws-lambda'
import { completeOffering } from '@libs/offeringComplete'
import { getPool } from '@libs/db'

export const main = async (event: SQSEvent, context: { callbackWaitsForEmptyEventLoop: boolean }): Promise<void> => {
  context.callbackWaitsForEmptyEventLoop = false

  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as {
      type: 'COMPLETE' | 'FAIL'
      paymentKey?: string
      orderId: string
      status?: string
      method?: string | null
      rawResponse?: unknown
    }

    if (payload.type === 'FAIL') {
      const pool = getPool()
      await pool.execute(
        `UPDATE offerings SET status = 'FAILED' WHERE order_id = ? AND status IN ('PENDING', 'PROCESSING')`,
        [payload.orderId]
      )
    } else {
      await completeOffering({
        paymentKey: payload.paymentKey!,
        orderId: payload.orderId,
        method: payload.method ?? null,
        rawResponse: payload.rawResponse,
      })
    }
  }
}
