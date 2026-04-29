import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { completeOffering } from '@libs/offeringComplete'
import { getPool } from '@libs/db'

const { TOSS_SECRET_KEY } = process.env

const FAILED_STATUSES = ['CANCELED', 'ABORTED', 'EXPIRED']

interface TossWebhookBody {
  eventType: string
  createdAt: string
  data: {
    paymentKey: string
    orderId: string
    status: string
    [key: string]: unknown
  }
}

interface TossPayment {
  paymentKey: string
  orderId: string
  status: string
  method?: string
  [key: string]: unknown
}

function verifyAuth(authHeader: string, expectedAuth: string): boolean {
  return !!authHeader && authHeader === expectedAuth
}

export const main: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false

  try {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not defined')

    // 1단: timing-safe Basic auth 검증
    const expectedAuth = `Basic ${Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')}`
    const authHeader = event.headers?.Authorization ?? event.headers?.authorization ?? ''
    if (!verifyAuth(authHeader, expectedAuth)) {
      return formatJSONResponse({ statusCode: 401, message: 'Unauthorized' })
    }

    const body = JSON.parse(event.body ?? '{}') as TossWebhookBody

    if (body.eventType !== 'PAYMENT_STATUS_CHANGED') {
      return formatJSONResponse({ message: 'ok' })
    }

    const { paymentKey, orderId, status } = body.data ?? {}

    // 2단: payload 필수값 검증
    if (!paymentKey || !orderId || !status) {
      return formatJSONResponse({ statusCode: 400, message: 'Invalid payload' })
    }

    if (status === 'DONE') {
      // 3단: paymentKey 재조회로 진위 및 상태 검증 (3초 타임아웃)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      let payment: TossPayment
      try {
        const tossRes = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}`, {
          headers: { Authorization: expectedAuth },
          signal: controller.signal,
        })

        // Toss API 장애 / 네트워크 오류 → 500으로 던져서 Toss가 재시도하게 함
        if (!tossRes.ok) {
          throw new Error(`Toss API error: ${tossRes.status}`)
        }

        payment = (await tossRes.json()) as TossPayment
      } finally {
        clearTimeout(timeout)
      }

      // 실제 데이터 불일치 → 재시도해도 같은 결과, 200으로 종료
      if (payment.status !== 'DONE' || payment.orderId !== orderId) {
        console.warn('Payment mismatch', { webhook: body.data, verified: payment })
        return formatJSONResponse({ message: 'ok' })
      }

      await completeOffering({
        paymentKey,
        orderId,
        method: payment.method ?? null,
        rawResponse: payment,
      })
    }

    if (FAILED_STATUSES.includes(status)) {
      console.info('Payment failed', { orderId, status, createdAt: body.createdAt })
      const pool = getPool()
      await pool.execute(
        `UPDATE offerings SET status = 'FAILED' WHERE order_id = ? AND status IN ('PENDING', 'PROCESSING')`,
        [orderId]
      )
    }

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}
