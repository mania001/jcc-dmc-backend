import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'

const test2: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  const { name } = event.pathParameters ?? {}

  return formatJSONResponse({
    message: `Hello, ${name ?? 'world'}!`,
    timestamp: new Date().toISOString(),
  })
}

export const main = middyfy(test2)
