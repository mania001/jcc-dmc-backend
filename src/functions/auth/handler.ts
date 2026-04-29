import * as jwt from 'jsonwebtoken'

const { JWT_SECRET } = process.env

const splitByDelimiter = (data: string, delim: string) => {
  const pos = data ? data.indexOf(delim) : -1
  return pos > 0 ? [data.substring(0, pos), data.substring(pos + 1)] : ['', '']
}

export const main = async (event: { authorizationToken: string; methodArn: string }) => {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined')
  const token = event.authorizationToken
  const [type, data] = splitByDelimiter(token, ' ')
  const allow = type === 'Bearer' && !!jwt.verify(data, JWT_SECRET)

  return {
    principalId: 'user',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: allow ? 'Allow' : 'Deny',
          Resource: event.methodArn,
        },
      ],
    },
  }
}
