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
    let whereClause = "WHERE result = 'T' AND YEAR(reg_date) = ?"

    if (name) {
      whereClause += ' AND name LIKE ?'
      whereParams.push(`%${name.trim()}%`)
    }

    if (ssn) {
      const targetSsn = ssn.replace(/-/g, '').replace(/ /g, '')
      if (targetSsn.length <= 6) {
        whereClause += ' AND (jumin1 LIKE ? OR jumin2 LIKE ?)'
        whereParams.push(`%${targetSsn}%`, `%${targetSsn}%`)
      } else if (targetSsn.length === 7) {
        whereClause += ' AND ((jumin1 = ? AND jumin2 LIKE ?) OR jumin2 = ?)'
        whereParams.push(targetSsn.substring(0, 6), `${targetSsn.substring(6, 7)}%`, targetSsn)
      } else {
        whereClause += ' AND (jumin1 = ? AND jumin2 LIKE ?)'
        whereParams.push(targetSsn.substring(0, 6), `${targetSsn.substring(6)}%`)
      }
    }

    if (email) {
      whereClause += ' AND email LIKE ?'
      whereParams.push(`%${email.trim()}%`)
    }

    const pool = getPool()

    const [sumResult] = await pool.execute<RowDataPacket[]>(
      `SELECT
         SUM(price1) + SUM(price2) + SUM(price3) + SUM(price4) + SUM(IFNULL(price5, 0)) AS totalPay,
         COUNT(*) AS cnt
       FROM intCard ${whereClause}`,
      whereParams
    )
    const { totalPay, cnt } = sumResult[0]

    const pageNum = Number(page)
    const sizeNum = Number(size)

    let dataQuery = `SELECT *, price1 + price2 + price3 + price4 + IFNULL(price5, 0) AS total
                     FROM intCard ${whereClause}
                     ORDER BY NUM DESC`

    const dataParams: (string | number)[] = [...whereParams]

    if (isPage === 'true') {
      dataQuery += ' LIMIT ? OFFSET ?'
      dataParams.push(sizeNum, (pageNum - 1) * sizeNum)
    }

    const [results] = await pool.execute<RowDataPacket[]>(dataQuery, dataParams)

    const currentPagePay = results.reduce((acc, cur) => acc + (cur.total ?? 0), 0)

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
