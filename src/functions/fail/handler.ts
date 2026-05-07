import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

import schema from './schema'

const { SQS_QUEUE_URL } = process.env
const sqs = new SQSClient({ region: 'ap-northeast-2' })

const fail: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    if (!SQS_QUEUE_URL) throw new Error('SQS_QUEUE_URL is not defined')

    const { orderId, paymentKey, errorCode, errorMessage } = event.body

    console.info('Payment fail reported', { orderId, errorCode, errorMessage })

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody: JSON.stringify({
          type: 'FAIL',
          paymentKey,
          orderId,
          status: errorCode,
        }),
      })
    )

    return formatJSONResponse({ status: 'ok' })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(fail)
