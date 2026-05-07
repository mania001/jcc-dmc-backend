import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

import schema from './schema'

const { TOSS_SECRET_KEY, SQS_QUEUE_URL } = process.env
const sqs = new SQSClient({ region: 'ap-northeast-2' })

const NON_RETRYABLE_CODES = new Set([
  'PAYMENT_NOT_FOUND',
  'NOT_FOUND_PAYMENT',
  'NOT_FOUND_PAYMENT_SESSION',
  'INVALID_PAYMENT_STATE',
  'ALREADY_PROCESSED_PAYMENT',
  'INVALID_ORDER_ID',
  'NOT_ALLOWED_PAYMENT',
])

const confirm: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not defined')
    if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL is not defined')

    const { paymentKey, orderId, amount } = event.body

    const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    let tossResponse: Response
    try {
      tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encoded}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentKey, orderId, amount }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const tossBody = (await tossResponse.json()) as { message?: string; code?: string; method?: string }

    if (!tossResponse.ok) {
      if (tossBody.code && NON_RETRYABLE_CODES.has(tossBody.code)) {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL!,
            MessageBody: JSON.stringify({ type: 'FAIL', orderId, status: tossBody.code }),
          })
        )
      }
      return formatJSONResponse({
        statusCode: tossResponse.status,
        message: tossBody.message ?? 'TossPay confirm failed',
        code: tossBody.code,
      })
    }

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody: JSON.stringify({
          type: 'COMPLETE',
          paymentKey,
          orderId,
          amount,
          method: tossBody.method ?? null,
          rawResponse: tossBody,
        }),
      })
    )

    return formatJSONResponse({ status: 'processing' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(confirm)
