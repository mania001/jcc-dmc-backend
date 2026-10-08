import type { AWS } from '@serverless/typescript'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config()
if (process.argv.includes('offline') && fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: true })
}
const stageIdx = process.argv.indexOf('--stage')
const stage = stageIdx !== -1 ? process.argv[stageIdx + 1] : 'dev'
if (stage === 'prod' && fs.existsSync('.env.prod')) {
  dotenv.config({ path: '.env.prod', override: true })
}

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
import fail from '@functions/fail'

const vpcConfig = {
  securityGroupIds: [process.env.VPC_SECURITY_GROUP_ID!],
  subnetIds: [process.env.VPC_SUBNET_ID_1!, process.env.VPC_SUBNET_ID_2!],
}

// 정상 응답(cors: true, responseCorsHeader)과 동일한 값. 리터럴이라 작은따옴표로 한 번 더 감싸야 함
const gatewayResponseCorsHeaders = {
  'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
  'gatewayresponse.header.Access-Control-Allow-Headers':
    "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amzn-Trace-Id'",
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
      target: 'node22',
      define: { 'require.resolve': undefined },
      platform: 'node',
    },
  },
  plugins: ['serverless-esbuild', 'serverless-dotenv-plugin', 'serverless-offline'],
  provider: {
    name: 'aws',
    runtime: 'nodejs22.x' as 'nodejs20.x',
    region: 'ap-northeast-2',
    profile: process.env.AWS_DEPLOY_PROFILE as unknown as undefined,
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
      SQS_QUEUE_URL: { Ref: 'OfferingUpdateQueue' } as unknown as string,
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
    fail,
    webhook,
  },
  resources: {
    Resources: {
      // API Gateway가 직접 만드는 에러 응답(authorizer 401/403, 500 등)에도 CORS 헤더를 붙임
      GatewayResponseDefault4XX: {
        Type: 'AWS::ApiGateway::GatewayResponse',
        Properties: {
          ResponseType: 'DEFAULT_4XX',
          RestApiId: { Ref: 'ApiGatewayRestApi' },
          ResponseParameters: gatewayResponseCorsHeaders,
        },
      },
      GatewayResponseDefault5XX: {
        Type: 'AWS::ApiGateway::GatewayResponse',
        Properties: {
          ResponseType: 'DEFAULT_5XX',
          RestApiId: { Ref: 'ApiGatewayRestApi' },
          ResponseParameters: gatewayResponseCorsHeaders,
        },
      },
      OfferingUpdateQueue: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: `jcc-dmc-offering-update-queue-${stage}`,
          VisibilityTimeout: 60,
          MessageRetentionPeriod: 86400,
        },
      },
    },
    Outputs: {
      OfferingUpdateQueueUrl: {
        Value: { Ref: 'OfferingUpdateQueue' },
        Export: { Name: `jcc-dmc-offering-update-queue-url-${stage}` },
      },
    },
  },
}

module.exports = serverlessConfiguration
