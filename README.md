# jcc-dmc-backend

예수중심교회 인터넷 헌금 백엔드. AWS Lambda(Serverless Framework) + RDS MySQL + Toss Payments로 동작한다.

- 헌금 신청 → Toss 결제 → 결제 완료 기록
- 관리자용 헌금 내역 조회 (기부금 영수증용, 주민번호 포함)
- 기존 MSSQL(`IntCard`) 데이터를 RDS로 옮기는 마이그레이션 스크립트

## 목차

- [구조](#구조)
- [준비물](#준비물)
- [환경변수](#환경변수)
- [로컬 실행](#로컬-실행)
- [배포](#배포)
- [API](#api)
- [관리자 계정 만들기](#관리자-계정-만들기)
- [RDS 접속 (SSH 터널)](#rds-접속-ssh-터널)
- [DB 마이그레이션 (MSSQL → RDS)](#db-마이그레이션-mssql--rds)
- [명령어 요약](#명령어-요약)
- [주의사항](#주의사항)

## 구조

```
프런트 ──► API Gateway ──► Lambda
                            ├─ VPC 안 (RDS 접근 가능, 인터넷 불가)
                            │    create, status, update, list, login, signup, verify, auth, dbUpdate
                            └─ VPC 밖 (인터넷 가능, RDS 접근 불가)
                                 confirm, fail, webhook ──► SQS ──► dbUpdate ──► RDS
```

한 Lambda가 RDS와 외부 API(Toss)를 동시에 쓸 수 없다. VPC에 NAT가 없기 때문이다. 그래서 Toss를 호출하는 함수는 결과를 SQS에 넣고, `dbUpdate`가 꺼내서 DB에 반영한다.

| 경로                           | 내용                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `serverless.ts`                | 함수, SQS, IAM 정의                                               |
| `src/functions/*`              | Lambda 핸들러 (함수별 `index.ts`에 경로, `schema.ts`에 요청 형식) |
| `src/libs/offeringComplete.ts` | 결제 완료 처리 (금액 검증 포함)                                   |
| `sql/init.sql`                 | 테이블 생성 스크립트                                              |
| `infra/`                       | VPC, Bastion CloudFormation 템플릿과 RDS 생성 설정                |
| `migration/`                   | MSSQL → RDS 마이그레이션 (별도 `package.json`)                    |

### 결제 흐름

1. 프런트가 `POST /offering/create`로 헌금을 신청한다 → `offerings`에 `PENDING`으로 저장.
2. 프런트가 Toss 결제창으로 결제한다.
3. 프런트가 `POST /offering/confirm`을 호출한다 → Toss 승인 → SQS에 완료 메시지.
4. Toss가 `POST /webhook/toss`도 호출한다 → Toss API로 재확인 → SQS에 완료 메시지 (3번이 실패했을 때의 안전망).
5. `dbUpdate`가 메시지를 처리한다 → `payments`에 기록하고 `offerings`를 `COMPLETED`로 변경.

완료 처리 규칙 (`src/libs/offeringComplete.ts`):

- 같은 결제(`payment_key`)는 한 번만 처리한다. confirm과 웹훅이 둘 다 와도 결과는 같다.
- Toss 실결제 금액(`totalAmount`)이 신청 금액과 다르면 `FAILED` / `fail_reason = AMOUNT_MISMATCH`로 남긴다. 결제 기록은 남으므로 Toss에서 수동 환불해야 한다. 이 건은 관리자 목록에 나오지 않는다.
- 실패 보고가 먼저 처리된 뒤 결제가 완료되어도 `COMPLETED`로 바뀐다. `CANCELED`는 바뀌지 않는다.

## 준비물

- Node.js 22 이상, npm
- AWS CLI와 `serverless-deployer` 프로필 (배포, Bastion 명령에 사용)
- Docker (로컬 MySQL용)
- RDS 접속이 필요하면 SSH 키 ([RDS 접속](#rds-접속-ssh-터널) 참고)

```bash
npm install
```

## 환경변수

`.env.example`을 복사해 `.env`를 만들고 값을 채운다. `.env*` 파일은 git에 올리지 않는다.

```bash
cp .env.example .env
```

| 파일             | 쓰이는 때           | 내용                                                                              |
| ---------------- | ------------------- | --------------------------------------------------------------------------------- |
| `.env`           | 항상                | 기본값. DB 접속 정보, `JWT_SECRET`, `ENCRYPTION_KEY`, `TOSS_SECRET_KEY`, VPC 설정 |
| `.env.local`     | `npm run offline`   | `.env`를 덮어쓴다. 로컬 DB 접속 정보                                              |
| `.env.prod`      | `--stage prod` 배포 | `.env`를 덮어쓴다. 운영용 Toss 키                                                 |
| `migration/.env` | `npm run migrate`   | MSSQL 접속 정보. `.env`를 덮어쓴다                                                |

- `ENCRYPTION_KEY`는 주민번호 뒷자리 암호화 키다. 바꾸면 기존 데이터를 복호화할 수 없다. 새로 만들 때만 `openssl rand -hex 32`로 생성한다.

## 로컬 실행

```bash
# 1. 로컬 MySQL 실행 (sql/init.sql로 테이블 자동 생성)
docker compose up -d

# 2. 로컬 DB를 보도록 설정
echo "DB_HOST=127.0.0.1" > .env.local

# 3. API 실행 (http://localhost:3000)
npm run offline
```

- `docker compose`는 `.env`의 `DB_NAME`, `DB_USER`, `DB_PWD`, `DB_ROOT_PWD`로 DB를 만든다. `DB_ROOT_PWD`가 비어 있으면 컨테이너가 뜨지 않는다.
- 로컬에는 SQS가 없다. 결제 완료 흐름(confirm, 웹훅 → `dbUpdate`)은 dev 스테이지에 배포해서 확인한다.

## 배포

```bash
npm run deploy        # dev 스테이지
npm run deploy:prod   # prod 스테이지 (.env.prod 적용)
```

- 배포가 끝나면 엔드포인트 목록이 출력된다.
- 배포 직후 몇 초 동안은 이전 설정으로 응답할 수 있다.
- `.env.prod`가 Toss 키를 바꾼다 (live 용으로 변경)
- `npm run remove`, `npm run remove:prod`는 스택 전체를 삭제한다. 평소에는 쓰지 않는다.

배포 확인 예시 (토큰 없이 호출하면 401이어야 한다):

```bash
curl -i https://<API ID>.execute-api.ap-northeast-2.amazonaws.com/prod/offerings
```

## API

| 메서드 | 경로                         | 인증              | 설명                                           |
| ------ | ---------------------------- | ----------------- | ---------------------------------------------- |
| POST   | `/offering/create`           | 없음              | 헌금 신청 (`PENDING` 생성)                     |
| POST   | `/offering/confirm`          | 없음              | Toss 결제 승인                                 |
| POST   | `/offering/fail`             | 없음              | 결제 실패 보고                                 |
| GET    | `/offering/status/{orderId}` | 없음              | 헌금 상태 조회                                 |
| POST   | `/webhook/toss`              | Toss API로 재확인 | Toss 웹훅                                      |
| POST   | `/login`                     | 없음              | 관리자 로그인, JWT 발급 (1일 유효)             |
| POST   | `/verify`                    | 없음              | JWT 검증                                       |
| POST   | `/signup`                    | Bearer            | 관리자 계정 생성                               |
| GET    | `/offerings`                 | Bearer            | 헌금 내역 조회 (완료 건, 주민번호 복호화 포함) |
| PATCH  | `/offering/{orderId}`        | Bearer            | 헌금 상태 수동 변경                            |

인증이 필요한 API는 `Authorization: Bearer <토큰>` 헤더를 붙인다.

`GET /offerings` 쿼리: `year`, `page`, `size`, `name`, `ssn`, `email`, `payType`, `isPage` (`false`면 전체 반환).

## 관리자 계정 만들기

`/signup`은 로그인한 관리자만 호출할 수 있다.

```bash
# 1. 기존 계정으로 로그인해 토큰 받기 (응답의 message가 토큰)
curl -X POST <API 주소>/login \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<기존 아이디>","password":"<비밀번호>"}'

# 2. 그 토큰으로 새 계정 만들기
curl -X POST <API 주소>/signup \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <토큰>' \
  -d '{"userId":"<새 아이디>","password":"<새 비밀번호>"}'
```

계정이 하나도 없으면 DB에 직접 넣는다. 비밀번호는 bcrypt 해시로 저장한다.

```bash
node -e "require('bcryptjs').hash(process.argv[1], 10).then(console.log)" '<비밀번호>'
```

```sql
INSERT INTO member (userid, password) VALUES ('<아이디>', '<위에서 나온 해시>');
```

## RDS 접속 (SSH 터널)

RDS(`jcc-db`)는 퍼블릭 액세스가 꺼져 있어, 같은 VPC의 서버를 거쳐야 접속된다.

### 방법 1: 스테이징 서버(웹 테스트를 위한) 경유 (권장)

스테이징 서버는 RDS와 같은 VPC에 있고 RDS 접근이 허용되어 있다.

```bash
ssh -i <aws-jcc-staging.pem 경로> \
  -L 3307:<RDS 엔드포인트>:3306 \
  ec2-user@<스테이징 서버 IP> -N
```

- 이 명령은 실행한 채로 둔다. 종료는 `Ctrl+C`.
- 열려 있는 동안 `127.0.0.1:3307`이 RDS로 연결된다.

GUI 도구(Sequel Ace 등)에서는 SSH 탭에 아래처럼 넣는다.

| 칸                  | 값                                                                |
| ------------------- | ----------------------------------------------------------------- |
| MySQL Host          | RDS 엔드포인트                                                    |
| Username / Password | DB 계정                                                           |
| SSH Host            | 스테이징 서버 IP                                                  |
| SSH User            | `ec2-user`                                                        |
| SSH Key             | `aws-jcc-staging.pem` (열쇠 아이콘으로 선택, SSH Password는 비움) |

### 방법 2: 임시 Bastion

스테이징 서버를 쓸 수 없을 때만 쓴다. 쓰고 나면 반드시 삭제한다.

```bash
npm run bastion:deploy    # 끝나면 Bastion IP 출력
ssh -i ~/.ssh/aws-jcc-web.pem -L 3307:<RDS 엔드포인트>:3306 ec2-user@<Bastion IP> -N
npm run bastion:delete    # 작업 후 삭제
```

## DB 마이그레이션 (MSSQL → RDS)

기존 시스템의 MSSQL `IntCard` DB(`intCard`, `MobilePay` 테이블)를 RDS의 `offerings`, `payments`로 옮긴다. 기존 시스템이 결제를 받는 동안에는 돌릴 때마다 그 사이에 생긴 건이 추가된다.

### 처음 한 번만

```bash
cd migration && npm install && cd ..
cp migration/.env.example migration/.env   # MSSQL 접속 정보 입력
```

- `migration/.env`의 `TOSS_SECRET_KEY`는 기존 결제에 쓰인 운영(라이브) 키여야 한다. 테스트 키를 넣으면 결제 조회가 전부 실패해 `payments`가 채워지지 않는다.
- RDS에 테이블이 없으면 마스터 계정으로 `sql/init.sql`을 먼저 적용한다. 앱 계정에는 테이블 생성 권한이 없다.

  ```bash
  mysql -h 127.0.0.1 -P 3307 -u <마스터 계정> -p jcc_dmc < sql/init.sql
  ```

### 실행 순서

1. [SSH 터널](#rds-접속-ssh-터널)을 연다 (`127.0.0.1:3307`).
2. 이 PC에서 MSSQL에 닿는지 확인한다.

   ```bash
   nc -vz <MSSQL 호스트> 1433
   ```

3. 마이그레이션을 실행한다. DB 접속 대상은 명령 앞의 환경변수로 지정한다.

   ```bash
   # 특정 날짜 이후만 (평소에는 이것을 쓴다)
   DB_HOST=127.0.0.1 DB_PORT=3307 npm run migrate -- --since=2026-10-06

   # 전체
   DB_HOST=127.0.0.1 DB_PORT=3307 npm run migrate

   # 이미 들어간 건의 contents(감사 내용)만 다시 채우기
   DB_HOST=127.0.0.1 DB_PORT=3307 npm run migrate -- --contents-only
   ```

4. 시작 로그의 `MySQL: 127.0.0.1/jcc_dmc`로 대상을 확인한다.
5. 마지막에 출력되는 결제수단/상태별 건수와 합계를 확인한다.
6. 터널을 닫는다.

`--since`에는 지난번 실행일보다 하루 이틀 앞선 날짜를 넣는다. 겹치는 건은 무시되므로 넉넉하게 잡아도 된다.

### 동작 방식

- **다시 돌려도 안전하다.** `order_id`, `payment_key`가 UNIQUE이고 `INSERT IGNORE`로 넣기 때문에 이미 있는 건은 건너뛴다.
- **주문번호**: MSSQL의 `seqcardnum`이 UUID면 그대로 쓰고, 아니면 `card-` 또는 `mobile-`을 앞에 붙인다.
- **상태**: MSSQL의 `result`가 `T`면 `COMPLETED`, 그 외는 `FAILED`.
- **주민번호 뒷자리**: 옮기면서 `ENCRYPTION_KEY`로 암호화한다.
- **결제 기록**: 완료된 UUID 주문마다 Toss API를 한 번씩 조회해 `payments`에 넣는다. 건당 0.1초 간격이라 건수가 많으면 오래 걸린다.
- **시각**: MSSQL의 `reg_date`(한국 시간)가 그대로 `created_at`에 들어간다. 실행하는 PC의 시간대와 무관하다.

### 문제가 생기면

| 증상                                      | 원인과 조치                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| MySQL 연결 타임아웃                       | 터널이 닫혔거나 `DB_HOST`/`DB_PORT`를 안 붙였다. `.env`의 `DB_HOST`는 RDS 주소라 PC에서 직접 닿지 않는다 |
| MSSQL 연결 실패                           | `nc -vz <MSSQL 호스트> 1433`으로 확인. `migration/.env` 값 확인                                          |
| `Toss 미확인`이 많이 나옴                 | `TOSS_SECRET_KEY`가 테스트 키거나 다른 상점 키다                                                         |
| `ENCRYPTION_KEY must be 32 bytes`         | `.env`의 `ENCRYPTION_KEY`가 64자리 16진수가 아니다                                                       |
| `Table 'jcc_dmc.offerings' doesn't exist` | 마스터 계정으로 `sql/init.sql`을 먼저 적용한다                                                           |

## 명령어 요약

| 명령                                                       | 설명                               |
| ---------------------------------------------------------- | ---------------------------------- |
| `npm run offline`                                          | 로컬 API 실행                      |
| `npm run deploy` / `deploy:prod`                           | dev / prod 배포                    |
| `npm run remove` / `remove:prod`                           | 스택 삭제                          |
| `npm run lint` / `lint:fix`                                | ESLint 검사 / 자동 수정            |
| `npm run format`                                           | Prettier 적용                      |
| `npm run migrate`                                          | MSSQL → RDS 마이그레이션           |
| `npm run bastion:deploy` / `bastion:ip` / `bastion:delete` | 임시 Bastion 생성 / IP 확인 / 삭제 |

## 주의사항

- `.env`, `.env.*`, `migration/.env`, `*.pem`, DB 덤프(`*.sql`)는 커밋하지 않는다. 주민번호와 비밀값이 들어 있다.
- 운영 DB를 직접 수정할 때는 먼저 건수를 조회해 확인하고, 트랜잭션 안에서 실행한다.
- `ENCRYPTION_KEY`를 잃어버리면 주민번호를 복구할 수 없다. 별도로 보관한다.
- RDS는 삭제 방지가 켜져 있고 CloudFormation 밖에서 수동 관리한다 (`infra/rds-settings.md`).
- default VPC의 기존 EC2 리소스는 삭제하지 않는다.
