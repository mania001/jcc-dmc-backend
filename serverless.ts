import type { AWS } from '@serverless/typescript'

import create from '@functions/create'
import confirm from '@functions/confirm'
import update from '@functions/update'
import signup from '@functions/signup'
import login from '@functions/login'
import verify from '@functions/verify'
import auth from '@functions/auth'
import list from '@functions/list'

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
    // VPC 설정: .env의 값으로 주입됨. sls offline 로컬 개발 시에는 불필요
    vpc: {
      securityGroupIds: ['${env:VPC_SECURITY_GROUP_ID, ""}'] as unknown as string[],
      subnetIds: ['${env:VPC_SUBNET_ID_1, ""}', '${env:VPC_SUBNET_ID_2, ""}'] as unknown as string[],
    },
  },
  functions: { create, confirm, update, signup, login, verify, auth, list },
}

module.exports = serverlessConfiguration
