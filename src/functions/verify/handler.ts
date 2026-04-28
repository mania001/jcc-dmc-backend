import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import * as jwt from 'jsonwebtoken'

import schema from './schema'

const { JWT_SECRET } = process.env

const verify: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
  try {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined')
    const { token } = event.body

    const result = jwt.verify(token, JWT_SECRET)

    return formatJSONResponse({
      message: { ok: true, result },
    })
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      message: { ok: false, error },
    })
  }
}

export const main = middyfy(verify)
