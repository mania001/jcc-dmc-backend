export default {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['userId', 'password'],
} as const
