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

## Deploy ขึ้น Railway (ไม่ต้องลงอะไรในเครื่อง)

ใน repo มี `Dockerfile` + `railway.json` ให้พร้อมแล้ว Railway จะอ่านอัตโนมัติ

### ขั้นตอน (web UI ล้วน)

1. **สมัคร Railway** — https://railway.com/login (login ด้วย GitHub)
   - free trial: $5 credit (ใช้แอปนี้ได้ ~2 เดือน) จากนั้น Hobby plan $5/เดือน

2. **สร้าง project จาก GitHub repo**
   - กด **New Project** → **Deploy from GitHub repo**
   - ครั้งแรกต้อง authorize Railway เข้าถึง GitHub
   - เลือก repo `Rinkina1/Test01`
   - Railway จะเริ่ม build จาก `Dockerfile` ทันที (ใช้เวลา ~3-5 นาที เพราะต้อง compile `better-sqlite3`)

3. **สร้าง Volume สำหรับ SQLite** ⚠️ สำคัญ — ถ้าไม่ทำ DB จะหายทุกครั้งที่ redeploy
   - คลิกที่ service → tab **Settings** → scroll หา **Volumes**
   - กด **+ New Volume**
   - Mount path: `/app/data`
   - กด Save → Railway จะ restart service

4. **ตั้ง Environment Variables** (tab **Variables**)
   - `JWT_SECRET` = สตริงสุ่มยาวๆ (สุ่มผ่าน PowerShell: `-join ((1..64) | %{[char[]]'abcdef0123456789' | Get-Random})`)
   - `ADMIN_PASSWORD` = password ที่ต้องการใช้ login admin
   - `ADMIN_USERNAME` = `admin` (หรือเปลี่ยน)
   - `NODE_ENV` = `production`

5. **เปิด public URL**
   - tab **Settings** → ส่วน **Networking** → **Generate Domain**
   - จะได้ URL เช่น `https://test01-production.up.railway.app` — เปิดใช้งานได้เลย

### Auto-deploy

Railway เชื่อม GitHub อัตโนมัติ — ทุกครั้งที่ push ไป main จะ deploy ใหม่เอง ไม่ต้องตั้งอะไรเพิ่ม

### ตรวจสอบสถานะ

- Logs: tab **Deployments** → คลิก deployment ล่าสุด → ดู build/runtime logs
- DB health check: `https://<your-url>/api/health/db` — จะแสดง path ของ SQLite + จำนวน response

## Deploy ขึ้น platform อื่น

ใช้ `Dockerfile` ที่ให้มาได้กับทุก platform (Render / Fly.io / VPS):

1. set env: `JWT_SECRET`, `ADMIN_PASSWORD`, `NODE_ENV=production`
2. **mount persistent volume ที่ `/app/data`** ไม่งั้น DB จะหายเวลา redeploy

## ความปลอดภัย

- Password เก็บเป็น bcrypt hash (cost 10)
- JWT ใน HttpOnly cookie (กัน XSS อ่าน token)
- Rate limit ทั้ง submit + login
- Prepared statements (ปลอดภัยจาก SQL injection)
- Validation ทั้ง client + server
- Foreign key + ON DELETE CASCADE — ลบ survey ลบ responses อัตโนมัติ
- WAL journal mode — รองรับ concurrent reads
