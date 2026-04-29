import type { AWS } from '@serverless/typescript'

import create from '@functions/create'
import confirm from '@functions/confirm'
import dbUpdate from '@functions/db-update'
import status from '@functions/status'
import update from '@functions/update'
import signup from '@functions/signup'
import login from '@functions/login'
import verify from '@functions/verify'
import auth from '@functions/auth'
import list from '@functions/list'
import webhook from '@functions/webhook'

const vpcConfig = {
  securityGroupIds: ['${env:VPC_SECURITY_GROUP_ID, ""}'] as unknown as string[],
  subnetIds: ['${env:VPC_SUBNET_ID_1, ""}', '${env:VPC_SUBNET_ID_2, ""}'] as unknown as string[],
}

const serverlessConfiguration: AWS = {
  service: 'jcc-dmc-backend',
  frameworkVersion: '3',
  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ['@aws-sdk/*'],
      target: 'node20',
      define: { 'require.resolve': undefined },
      platform: 'node',
    },
  },
  plugins: ['serverless-esbuild', 'serverless-dotenv-plugin', 'serverless-offline'],
  provider: {
    name: 'aws',
    runtime: 'nodejs20.x',
    region: 'ap-northeast-2',
    profile: '${env:AWS_DEPLOY_PROFILE, ""}' as unknown as undefined,
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
    },
    iam: {
      role: {
        statements: [
          {
            Effect: 'Allow',
            Action: ['sqs:SendMessage'],
            Resource: [{ 'Fn::GetAtt': ['OfferingUpdateQueue', 'Arn'] }] as unknown as string[],
          },
        ],
      },
    },
  },
  functions: {
    // DB 접근 Lambda (VPC 내부)
    create: { ...create, vpc: vpcConfig },
    dbUpdate: { ...dbUpdate, vpc: vpcConfig },
    status: { ...status, vpc: vpcConfig },
    update: { ...update, vpc: vpcConfig },
    signup: { ...signup, vpc: vpcConfig },
    login: { ...login, vpc: vpcConfig },
    verify: { ...verify, vpc: vpcConfig },
    auth: { ...auth, vpc: vpcConfig },
    list: { ...list, vpc: vpcConfig },
    // 인터넷 접근 필요 Lambda (VPC 없음)
    confirm,
    webhook,
  },
  resources: {
    Resources: {
      OfferingUpdateQueue: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: 'jcc-dmc-offering-update-queue',
          VisibilityTimeout: 60,
          MessageRetentionPeriod: 86400,
        },
      },
    },
    Outputs: {
      OfferingUpdateQueueUrl: {
        Value: { Ref: 'OfferingUpdateQueue' },
        Export: { Name: 'jcc-dmc-offering-update-queue-url' },
      },
    },
  },
}

module.exports = serverlessConfiguration
