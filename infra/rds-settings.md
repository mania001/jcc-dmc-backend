# RDS 생성 설정

콘솔에서 수동 생성. 실수로 삭제되는 위험을 피하기 위해 CF 스택에서 분리하여 관리.

## 콘솔 경로

AWS Console → RDS → 데이터베이스 생성

---

## 설정값

### 엔진

| 항목      | 값           |
| --------- | ------------ |
| 엔진 유형 | MySQL        |
| 버전      | 8.0.x (최신) |

### 템플릿

| 항목   | 값          |
| ------ | ----------- |
| 템플릿 | 개발/테스트 |

### 설정

| 항목               | 값                                              |
| ------------------ | ----------------------------------------------- |
| DB 인스턴스 식별자 | jcc-db                                          |
| 마스터 사용자 이름 | (별도 보관)                                     |
| 마스터 암호        | (생성 후 별도 보관, .env에는 앱 전용 계정 사용) |

### 인스턴스 구성

| 항목               | 값                                         |
| ------------------ | ------------------------------------------ |
| 인스턴스 클래스    | db.t4g.small (Graviton2, t3 대비 20% 저렴) |
| 스토리지 유형      | gp3                                        |
| 할당된 스토리지    | 20 GB                                      |
| 스토리지 자동 조정 | 비활성화                                   |

### 가용성 및 내구성

| 항목    | 값                             |
| ------- | ------------------------------ |
| 다중 AZ | 아니요 (필요 시 나중에 활성화) |

### 연결

| 항목           | 값                  |
| -------------- | ------------------- |
| VPC            | jcc-custom-vpc      |
| DB 서브넷 그룹 | jcc-db-subnet-group |
| 퍼블릭 액세스  | 아니요              |
| VPC 보안 그룹  | SG-RDS              |
| 가용 영역      | ap-northeast-2a     |
| 포트           | 3306                |

### 데이터베이스 인증

| 항목      | 값        |
| --------- | --------- |
| 인증 방법 | 암호 인증 |

### 추가 구성

| 항목                        | 값                              |
| --------------------------- | ------------------------------- |
| 초기 데이터베이스 이름      | (비워두기 - 아래에서 수동 생성) |
| 백업 보존 기간              | 7일                             |
| 자동 백업                   | 활성화                          |
| 삭제 방지                   | **활성화** (중요)               |
| 마이너 버전 자동 업그레이드 | 비활성화                        |

---

## 생성 후 DB 및 앱 계정 설정

마스터 계정으로 접속 후 DB별 전용 계정 생성:

```sql
-- DB 생성
CREATE DATABASE jcc_dmc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE jcc_book CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- (필요한 DB 추가)

-- DB별 앱 전용 계정 생성
CREATE USER 'jcc_dmc_app'@'%' IDENTIFIED BY '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON jcc_dmc.* TO 'jcc_dmc_app'@'%';

CREATE USER 'jcc_book_app'@'%' IDENTIFIED BY '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON jcc_book.* TO 'jcc_book_app'@'%';

FLUSH PRIVILEGES;
```

각 앱 `.env`의 `DB_USER` / `DB_PWD`는 앱 전용 계정 사용. 마스터 계정은 어드민 용도로만 보관.

---

## .env에 추가할 값 (앱 전용 계정)

```
DB_HOST=<RDS 엔드포인트>
DB_PORT=3306
DB_USER=<앱 전용 계정>
DB_NAME=<DB명>
```

`DB_PWD`는 .env에 직접 입력 (git 제외 확인).

---

## Dump 복원 (bastion 경유)

```bash
# 1. bastion CF 스택 배포 (infra/bastion.yaml)
# 2. SSH 터널
ssh -i ~/.ssh/<키페어>.pem -L 13306:<RDS 엔드포인트>:3306 ec2-user@<BastionIP> -N

# 3. 로컬에서 RDS에 dump 복원
mysql -h 127.0.0.1 -P 13306 -u <마스터계정> -p <DB명> < sql/dump.sql

# 4. 완료 후 bastion 스택 삭제
```
