import * as mssql from 'mssql'
import mysql from 'mysql2/promise'
import * as dotenv from 'dotenv'
import { createCipheriv, randomBytes } from 'crypto'

dotenv.config({ path: '../.env' }) // 공유 변수 (ENCRYPTION_KEY, TOSS_SECRET_KEY, DB_*)
dotenv.config() // MSSQL 전용 (.env, 기존 값 유지)

// ── 암호화 ─────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32
const IV_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not defined')
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== KEY_LENGTH) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  return buf
}

function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

// ── UUID 판별 ──────────────────────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildOrderId(seqcardnum: string, prefix: string): string {
  if (UUID_REGEX.test(seqcardnum)) return seqcardnum
  return `${prefix}-${seqcardnum}`
}

// ── DB 설정 ────────────────────────────────────────────────────────────────
const mssqlConfig: mssql.config = {
  server: process.env.MSSQL_HOST!,
  port: Number(process.env.MSSQL_PORT) || 1433,
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PWD,
  database: process.env.MSSQL_DB,
  options: { encrypt: false, trustServerCertificate: true },
}

const mysqlConfig: mysql.PoolOptions = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
  database: process.env.DB_NAME,
}

const BATCH_SIZE = 500

// ── 타입 ───────────────────────────────────────────────────────────────────
interface MssqlRow {
  num: number
  name: string
  jumin1: string | null
  jumin2: string | null
  email: string | null
  price1: number | null
  price2: number | null
  price3: number | null
  price4: number | null
  price5: number | null
  reg_date: Date
  seqcardnum: string
  result: string
}

interface TaggedRow extends MssqlRow {
  payType: 'card' | 'mobile'
  orderIdPrefix: string
}

interface TossPayment {
  paymentKey: string
  orderId: string
  status: string
  method?: string
  [key: string]: unknown
}

// ── 유틸 ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── MSSQL 조회 ─────────────────────────────────────────────────────────────
async function fetchFromMssql(
  mssqlPool: mssql.ConnectionPool,
  tableName: string,
  payType: 'card' | 'mobile',
  orderIdPrefix: string
): Promise<TaggedRow[]> {
  console.log(`[${tableName}] 조회 중...`)
  const result = await mssqlPool.request().query<MssqlRow>(`
    SELECT num, name, jumin1, jumin2, email,
           price1, price2, price3, price4, price5,
           reg_date, seqcardnum, result
    FROM dbo.${tableName}
    ORDER BY num
  `)
  const rows = result.recordset
  const completed = rows.filter((r) => r.result === 'T').length
  const failed = rows.length - completed
  console.log(`[${tableName}] 전체 ${rows.length}건 (완료: ${completed}, 실패: ${failed})`)
  return rows.map((r) => ({ ...r, payType, orderIdPrefix }))
}

// ── offerings 배치 INSERT ──────────────────────────────────────────────────
async function insertOfferingsBatch(pool: mysql.Pool, rows: TaggedRow[]): Promise<void> {
  if (rows.length === 0) return

  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
  const values = rows.flatMap((r) => {
    const tithe = r.price1 ?? 0
    const thanks = r.price2 ?? 0
    const building = r.price3 ?? 0
    const mission = r.price4 ?? 0
    const relief = r.price5 ?? 0
    const amount = tithe + thanks + building + mission + relief
    const status = r.result === 'T' ? 'COMPLETED' : 'FAILED'

    return [
      r.name,
      r.jumin1 ?? '',
      encrypt(r.jumin2 ?? ''),
      r.email ?? null,
      tithe,
      thanks,
      building,
      mission,
      relief,
      amount,
      r.payType,
      buildOrderId(r.seqcardnum, r.orderIdPrefix),
      status,
      r.reg_date,
    ]
  })

  await pool.query(
    `INSERT IGNORE INTO offerings
       (name, jumin1, jumin2, email, tithe, thanks, building, mission, relief, amount,
        pay_type, order_id, status, created_at)
     VALUES ${placeholders}`,
    values
  )
}

// ── Toss API 단건 조회 (404/429 핸들링) ────────────────────────────────────
async function fetchTossPayment(orderId: string, auth: string, retries = 3): Promise<TossPayment | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/orders/${orderId}`, {
      headers: { Authorization: auth },
    })

    if (res.ok) return (await res.json()) as TossPayment
    if (res.status === 404) return null

    if (res.status === 429) {
      const wait = 1000 * Math.pow(2, attempt)
      console.warn(`\n[payments] rate limit, ${wait}ms 대기 후 재시도...`)
      await sleep(wait)
      continue
    }

    throw new Error(`Toss API error: ${res.status}`)
  }
  throw new Error(`[payments] ${orderId} 최대 재시도 초과`)
}

// ── 2026년 COMPLETED UUID → payments 삽입 ─────────────────────────────────
async function insertPaymentsFromToss(pool: mysql.Pool): Promise<void> {
  if (!process.env.TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY is not defined')
  const auth = `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString('base64')}`

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT order_id FROM offerings
     WHERE YEAR(created_at) = 2026
       AND status = 'COMPLETED'
       AND order_id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`
  )

  console.log(`\n[payments] 2026 COMPLETED UUID ${rows.length}건 Toss API 조회 시작`)

  let success = 0,
    notFound = 0,
    errors = 0

  for (const row of rows) {
    try {
      const payment = await fetchTossPayment(row.order_id as string, auth)

      if (payment) {
        await pool.execute(
          `INSERT IGNORE INTO payments (order_id, payment_key, method, status, raw_response)
           VALUES (?, ?, ?, 'DONE', ?)`,
          [row.order_id, payment.paymentKey, payment.method ?? null, JSON.stringify(payment)]
        )
        success++
      } else {
        notFound++
      }
    } catch (err) {
      errors++
      console.warn(`\n[payments] ${row.order_id} 실패: ${String(err)}`)
    }

    await sleep(100)
    process.stdout.write(
      `\r[payments] ${success + notFound + errors}/${rows.length} (성공: ${success}, 미확인: ${notFound}, 오류: ${errors})`
    )
  }

  console.log(`\n[payments] 완료 — 삽입: ${success}, Toss 미확인: ${notFound}, 오류: ${errors}`)
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== JCC DMC 데이터 마이그레이션 시작 ===')
  console.log(`MSSQL: ${process.env.MSSQL_HOST}/${process.env.MSSQL_DB}`)
  console.log(`MySQL: ${process.env.DB_HOST}/${process.env.DB_NAME}\n`)

  const mssqlPool = await mssql.connect(mssqlConfig)
  console.log('MSSQL 연결 성공')

  const mysqlPool = mysql.createPool(mysqlConfig)
  console.log('MySQL 연결 성공\n')

  try {
    // 양쪽 테이블 전체 메모리 로드
    const cardRows = await fetchFromMssql(mssqlPool, 'intCard', 'card', 'card')
    const mobileRows = await fetchFromMssql(mssqlPool, 'MobilePay', 'mobile', 'mobile')

    // created_at(reg_date) 오름차순 정렬 → id 순서가 날짜 순서와 일치
    const allRows = [...cardRows, ...mobileRows].sort((a, b) => a.reg_date.getTime() - b.reg_date.getTime())

    console.log(`\n[offerings] 전체 ${allRows.length}건 created_at 순 삽입 시작`)

    let inserted = 0
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      await insertOfferingsBatch(mysqlPool, allRows.slice(i, i + BATCH_SIZE))
      inserted += Math.min(BATCH_SIZE, allRows.length - i)
      process.stdout.write(`\r[offerings] ${inserted}/${allRows.length}건 완료`)
    }
    console.log('\n[offerings] 마이그레이션 완료')

    // 2026년 COMPLETED UUID → Toss API로 payments 삽입
    await insertPaymentsFromToss(mysqlPool)

    // 최종 결과
    const [offeringRows] = await mysqlPool.query<mysql.RowDataPacket[]>(
      `SELECT pay_type, status, COUNT(*) AS cnt, SUM(amount) AS total
       FROM offerings GROUP BY pay_type, status ORDER BY pay_type, status`
    )
    const [paymentRows] = await mysqlPool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM payments')

    console.log('\n=== 최종 결과 ===')
    offeringRows.forEach((r) =>
      console.log(`  offerings ${r.pay_type}/${r.status}: ${r.cnt}건 / ${Number(r.total).toLocaleString()}원`)
    )
    console.log(`  payments: ${paymentRows[0].cnt}건`)
    console.log('\n마이그레이션 완료!')
  } finally {
    await mssqlPool.close()
    await mysqlPool.end()
  }
}

main().catch((err) => {
  console.error('마이그레이션 실패:', err)
  process.exit(1)
})
