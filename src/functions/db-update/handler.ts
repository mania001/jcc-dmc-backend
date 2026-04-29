import type { SQSEvent } from 'aws-lambda'
import { completeOffering } from '@libs/offeringComplete'

export const main = async (event: SQSEvent, context: { callbackWaitsForEmptyEventLoop: boolean }): Promise<void> => {
  context.callbackWaitsForEmptyEventLoop = false

  for (const record of event.Records) {
    const payload = JSON.parse(record.body)
    await completeOffering({
      paymentKey: payload.paymentKey,
      orderId: payload.orderId,
      method: payload.method ?? null,
      rawResponse: payload.rawResponse,
    })
  }
}
