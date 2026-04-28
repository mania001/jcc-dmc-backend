CREATE TABLE IF NOT EXISTS member (
  num      INT AUTO_INCREMENT PRIMARY KEY,
  userid   VARCHAR(30)  NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment (
  num         INT AUTO_INCREMENT PRIMARY KEY,
  pay_type    ENUM('card', 'mobile') NOT NULL,
  name        VARCHAR(30)   NOT NULL,
  jumin1      VARCHAR(6),
  jumin2      VARCHAR(7),
  email       VARCHAR(80),
  price1      DECIMAL(18,0),
  price2      DECIMAL(18,0),
  price3      DECIMAL(18,0),
  price4      DECIMAL(18,0),
  price5      DECIMAL(18,0),
  contents    TEXT,
  order_id    VARCHAR(64)   NOT NULL UNIQUE,
  payment_key VARCHAR(200),
  result      CHAR(1)       NOT NULL DEFAULT 'F',
  reg_date    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
