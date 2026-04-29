import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

const { TOSS_SECRET_KEY, SQS_QUEUE_URL } = process.env
const sqs = new SQSClient({ region: 'ap-northeast-2' })

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
    if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL is not defined')

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

    if (!paymentKey || !orderId || !status) {
      return formatJSONResponse({ statusCode: 400, message: 'Invalid payload' })
    }

    if (status === 'DONE') {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      let payment: TossPayment
      try {
        const tossRes = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}`, {
          headers: { Authorization: expectedAuth },
          signal: controller.signal,
        })

        if (!tossRes.ok) {
          throw new Error(`Toss API error: ${tossRes.status}`)
        }

        payment = (await tossRes.json()) as TossPayment
      } finally {
        clearTimeout(timeout)
      }

      if (payment.status !== 'DONE' || payment.orderId !== orderId) {
        console.warn('Payment mismatch', { webhook: body.data, verified: payment })
        return formatJSONResponse({ message: 'ok' })
      }

      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              type: 'COMPLETE',
              paymentKey,
              orderId,
              method: payment.method ?? null,
              rawResponse: payment,
            }),
          })
        )
      } catch (e) {
        // 의도적으로 throw → 500 반환 → Toss 재시도 유도
        throw e
      }
    }

    if (FAILED_STATUSES.includes(status)) {
      console.info('Payment failed', { orderId, status, createdAt: body.createdAt })
      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              type: 'FAIL',
              paymentKey,
              orderId,
              status,
            }),
          })
        )
      } catch (e) {
        // 의도적으로 throw → 500 반환 → Toss 재시도 유도
        throw e
      }
    }

    return formatJSONResponse({ message: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}
