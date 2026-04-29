import { handlerPath } from '@libs/handlerResolver'

export default {
  handler: `${handlerPath(__dirname)}/handler.main`,
  events: [
    {
      sqs: {
        arn: { 'Fn::GetAtt': ['OfferingUpdateQueue', 'Arn'] },
        batchSize: 10,
        functionResponseType: 'ReportBatchItemFailures' as const,
      },
    },
  ],
}
