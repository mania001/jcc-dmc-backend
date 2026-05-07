import schema from './schema'
import { handlerPath } from '@libs/handlerResolver'

export default {
  handler: `${handlerPath(__dirname)}/handler.main`,
  timeout: 30,
  events: [
    {
      http: {
        method: 'post',
        path: 'offering/confirm',
        cors: true,
        request: {
          schemas: {
            'application/json': schema,
          },
        },
      },
    },
  ],
}
