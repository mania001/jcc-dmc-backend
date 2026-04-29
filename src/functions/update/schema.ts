export default {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
  },
  required: ['status'],
} as const
