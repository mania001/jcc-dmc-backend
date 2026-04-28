import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'

type ValidatedAPIGatewayProxyEvent<S extends JSONSchema> = Omit<APIGatewayProxyEvent, 'body'> & { body: FromSchema<S> }
export type ValidatedEventAPIGatewayProxyEvent<S extends JSONSchema> = Handler<
  ValidatedAPIGatewayProxyEvent<S>,
  APIGatewayProxyResult
>

export const responseCorsHeader = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': false,
  'Content-Type': 'application/json',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE',
}

export const formatJSONResponse = (response: Record<string, unknown>) => {
  return {
    statusCode: (response.statusCode as number | undefined) ?? 200,
    headers: {
      ...responseCorsHeader,
    },
    body: JSON.stringify(response),
  }
}
