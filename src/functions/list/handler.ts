import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda'
import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import { getPool } from '@libs/db'
import type { RowDataPacket } from 'mysql2'

const list: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false
  try {
    const {
      year,
      page = '1',
      size = '25',
      name = '',
      ssn = '',
      email = '',
      isPage = 'true',
    } = (event.queryStringParameters ?? {}) as Record<string, string>

    const today = new Date()
    const targetYear = year ?? (today.getMonth() > 5 ? String(today.getFullYear()) : String(today.getFullYear() - 1))

    const whereParams: (string | number)[] = [targetYear]
    let whereClause = "WHERE status = 'COMPLETED' AND YEAR(created_at) = ?"

    if (name) {
      whereClause += ' AND name LIKE ?'
      whereParams.push(`%${name.trim()}%`)
    }

    if (ssn) {
      const digits = ssn.replace(/[-\s]/g, '')
      const jumin1Part = digits.substring(0, 6)
      if (jumin1Part.length < 6) {
        whereClause += ' AND jumin1 LIKE ?'
        whereParams.push(`${jumin1Part}%`)
      } else {
        whereClause += ' AND jumin1 = ?'
        whereParams.push(jumin1Part)
      }
    }

    if (email) {
      whereClause += ' AND email LIKE ?'
      whereParams.push(`%${email.trim()}%`)
    }

    const pool = getPool()

    const [sumResult] = await pool.query<RowDataPacket[]>(
      `SELECT SUM(amount) AS totalPay, COUNT(*) AS cnt FROM offerings ${whereClause}`,
      whereParams
    )
    const { totalPay, cnt } = sumResult[0]

    const pageNum = Number(page)
    const sizeNum = Number(size)

    let dataQuery = `SELECT id, name, jumin1, email, tithe, thanks, building, mission, relief, amount, pay_type, order_id, status, created_at
                     FROM offerings ${whereClause}
                     ORDER BY id DESC`

    const dataParams: (string | number)[] = [...whereParams]

    if (isPage === 'true') {
      dataQuery += ' LIMIT ? OFFSET ?'
      dataParams.push(sizeNum, (pageNum - 1) * sizeNum)
    }

    const [results] = await pool.query<RowDataPacket[]>(dataQuery, dataParams)

    const currentPagePay = results.reduce((acc, cur) => acc + Number(cur.amount ?? 0), 0)

    return formatJSONResponse({
      message: {
        pageInfo: {
          current: pageNum,
          pageSize: isPage === 'true' ? sizeNum : Number(cnt),
          totalPage: isPage === 'true' ? Math.ceil(Number(cnt) / sizeNum) : 1,
          totalResults: cnt,
        },
        paymentInfo: { totalPay, currentPagePay },
        results,
      },
    })
  } catch (err) {
    return formatJSONResponse({ statusCode: 500, message: String(err) })
  }
}

export const main = middyfy(list)
