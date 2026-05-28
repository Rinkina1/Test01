# Survey Platform

ระบบเก็บข้อมูลแบบสอบถาม generic รองรับสร้างแบบสอบถามได้หลายชุดผ่าน Admin Dashboard (ไม่ต้องแก้โค้ด)

**Stack:** Node.js + Express + **SQLite** (ผ่าน `better-sqlite3`)

## ฟีเจอร์

- สร้างแบบสอบถามได้หลายชุดผ่าน Admin UI ไม่ต้องแก้โค้ด
- รองรับ field 9 ประเภท: text, textarea, email, tel, number, radio, checkbox, select, rating
- Validation อัตโนมัติทั้ง client + server
- Admin Dashboard — สถิติ, รายการคำตอบ, ลบ, export CSV
- Auth: JWT + HttpOnly cookie + bcrypt
- Rate limiting (20 ครั้ง / 15 นาที สำหรับ submit, 5 ครั้งสำหรับ login)
- ข้อมูลเก็บใน SQLite database file (`data/survey.db`)

## เริ่มใช้งาน

ต้องมี **Node.js 18+** (ดาวน์โหลด: https://nodejs.org)

```bash
cd survey-platform
npm install
npm start
```

เปิด:
- หน้าแรก: http://localhost:3000/
- Admin: http://localhost:3000/admin.html
- Default login: `admin` / `admin123`

ขั้นตอนทดสอบเร็ว:
1. login เข้า `/admin.html`
2. กด **+ ตัวอย่าง** เพื่อสร้างแบบสอบถามตัวอย่าง
3. คลิกลิงก์ "เปิดหน้าตอบ" เพื่อทดลองตอบ
4. กลับมาที่ Dashboard กด **ดูคำตอบ** + **Export CSV**

## โครงสร้าง

```
survey-platform/
├── server.js           # Express + SQLite + API
├── database.sql        # Schema (อ่านอัตโนมัติตอนเริ่ม server)
├── package.json
├── .env.example
├── data/               # (gitignored) เก็บไฟล์ DB
│   └── survey.db
└── public/
    ├── storage.js      # API client
    ├── styles.css
    ├── index.html      # หน้าแรก (list surveys ที่เปิดอยู่)
    ├── survey.html     # หน้าตอบแบบสอบถาม (dynamic)
    ├── login.html
    ├── admin.html      # admin dashboard
    └── admin-survey.html  # ดูคำตอบ + export
```

## Environment variables

| ตัวแปร | Default | อธิบาย |
|---|---|---|
| `PORT` | `3000` | port |
| `JWT_SECRET` | `change-this-...` | **ต้องเปลี่ยนใน production** |
| `ADMIN_USERNAME` | `admin` | admin คนแรก (สร้างตอน DB ว่าง) |
| `ADMIN_PASSWORD` | `admin123` | password admin คนแรก |
| `DATA_DIR` | `./data` | โฟลเดอร์เก็บ SQLite file |
| `NODE_ENV` | `development` | `production` เปิด secure cookie |

## Database

SQLite schema อยู่ใน [database.sql](database.sql) — server.js โหลดและสร้างตารางอัตโนมัติเมื่อ start

### Tables
- `admins` — ผู้ดูแลระบบ (bcrypt hash)
- `surveys` — แบบสอบถาม (fields เก็บเป็น JSON ใน `fields_json`)
- `responses` — คำตอบ (data เก็บเป็น JSON ใน `data_json`, FK ไปยัง surveys, ON DELETE CASCADE)

### Backup

```bash
# Copy SQLite file
cp data/survey.db backup/survey-$(date +%Y%m%d).db

# หรือใช้ SQL dump
sqlite3 data/survey.db .dump > backup.sql
```

### Inspect

```bash
sqlite3 data/survey.db
> .tables
> SELECT id, title, slug, active FROM surveys;
> SELECT COUNT(*) FROM responses;
```

## API

### Public
- `GET /api/surveys` — list surveys ที่ active
- `GET /api/surveys/:slug` — ดู schema
- `POST /api/surveys/:slug/responses` — ส่งคำตอบ (rate limited)

### Admin (ต้อง login)
- `POST /api/admin/login` / `POST /api/admin/logout` / `GET /api/admin/me`
- `GET /api/admin/stats`
- `GET|POST /api/admin/surveys`
- `GET|PUT|DELETE /api/admin/surveys/:id`
- `GET /api/admin/surveys/:id/responses?page=&limit=`
- `GET /api/admin/surveys/:id/export` — CSV (UTF-8 BOM)
- `POST /api/admin/seed-demo` — สร้างแบบสอบถามตัวอย่าง
- `DELETE /api/admin/responses/:id`

### Health
- `GET /health` — server status
- `GET /api/health/db` — SQLite connection + response count

## Deploy

ทุก platform ที่รัน Node.js ได้ใช้ได้ (Railway, Render, Fly.io, VPS):

1. `npm install` (จะ compile `better-sqlite3` native — ต้องการ build tools)
2. set env: `JWT_SECRET`, `ADMIN_PASSWORD`, `NODE_ENV=production`
3. **mount persistent volume ที่ `./data`** ไม่งั้น DB จะหายเวลา redeploy
4. `npm start`

## ความปลอดภัย

- Password เก็บเป็น bcrypt hash (cost 10)
- JWT ใน HttpOnly cookie (กัน XSS อ่าน token)
- Rate limit ทั้ง submit + login
- Prepared statements (ปลอดภัยจาก SQL injection)
- Validation ทั้ง client + server
- Foreign key + ON DELETE CASCADE — ลบ survey ลบ responses อัตโนมัติ
- WAL journal mode — รองรับ concurrent reads
