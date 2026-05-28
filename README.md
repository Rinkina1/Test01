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

## Deploy ขึ้น Fly.io (ไม่ต้องลงอะไรในเครื่อง)

ใน repo มี `Dockerfile`, `fly.toml`, GitHub Actions workflow ให้พร้อมแล้ว

### ขั้นตอน (Web UI — ไม่ต้องลง CLI)

1. **สมัคร Fly.io** — https://fly.io/app/sign-up (login ด้วย GitHub ได้) — ต้องผูกบัตรเครดิตแต่ไม่เก็บเงินจนกว่า usage จะเกิน free allowance ($5)

2. **Launch app จาก GitHub** — เปิด https://fly.io/launch แล้ว:
   - Connect GitHub → เลือก `Rinkina1/Test01`
   - Fly จะอ่าน `fly.toml` ใน repo อัตโนมัติ
   - ตั้ง app name (ต้องไม่ซ้ำ เช่น `survey-rinkina1`)
   - เลือก region: **sin** (Singapore)
   - กด **Deploy**

3. **สร้าง persistent volume สำหรับ SQLite**
   - ไปที่ tab **Volumes** ของ app
   - กด **Create Volume** → name: `survey_data`, region: `sin`, size: `1 GB`
   - กลับไปที่ Deployments → Redeploy

4. **ตั้ง Secrets** (ที่ tab **Secrets** ของ app):
   - `JWT_SECRET` = สตริงสุ่มยาวๆ (เช่น `openssl rand -hex 32`)
   - `ADMIN_PASSWORD` = password ที่ต้องการ
   - `ADMIN_USERNAME` = `admin` (หรือเปลี่ยน)

5. รอ deploy เสร็จ — Fly จะให้ URL เช่น `https://survey-rinkina1.fly.dev` ใช้งานได้เลย

### Auto-deploy ด้วย GitHub Actions

มี `.github/workflows/fly-deploy.yml` ให้ — ทุกครั้งที่ push ไป main จะ deploy อัตโนมัติ ขั้นตอน setup:

1. ที่ Fly.io ไป **Account → Access Tokens** → สร้าง token ใหม่
2. ที่ GitHub repo `Rinkina1/Test01` → **Settings → Secrets → Actions** → New secret
   - Name: `FLY_API_TOKEN`
   - Value: token ที่ได้จาก Fly

หลังจากนั้น push commit ใหม่ → workflow รัน → deploy เอง

### หรือใช้ flyctl CLI (ทางเลือก ถ้าต้องการลง)

```powershell
iwr https://fly.io/install.ps1 -useb | iex   # ติดตั้ง flyctl
fly auth login
fly launch --copy-config --no-deploy
fly volumes create survey_data --region sin --size 1
fly secrets set JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=mypassword
fly deploy
```

## Deploy ขึ้น platform อื่น

ใช้ `Dockerfile` ที่ให้มาได้กับทุก platform (Railway / Render / Fly.io / VPS):

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
