import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

import schema from './schema'

const { TOSS_SECRET_KEY, SQS_QUEUE_URL } = process.env
const sqs = new SQSClient({ region: 'ap-northeast-2' })

const confirm: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not defined')
    if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL is not defined')

    const { paymentKey, orderId, amount } = event.body

    const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')
    const tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })

    const tossBody = (await tossResponse.json()) as { message?: string; code?: string; method?: string }

    if (!tossResponse.ok) {
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
