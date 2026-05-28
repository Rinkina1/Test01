# Survey Platform

ระบบเก็บข้อมูลแบบสอบถาม generic รองรับสร้างแบบสอบถามได้หลายชุดผ่าน Admin Dashboard (ไม่ต้องแก้โค้ด)

ใช้งานได้ 2 โหมด:

| โหมด | คำอธิบาย | ติดตั้ง |
|---|---|---|
| **Client-side** (default) | ทำงานในเบราว์เซอร์ล้วน — เก็บข้อมูลใน `localStorage` | เปิด `public/index.html` ได้เลย |
| **Server** | Node.js + Express เก็บไฟล์ JSON ฝั่ง server มี auth + rate limit | `npm install && npm start` |

## ฟีเจอร์

- **สร้างแบบสอบถามได้หลายชุด** ผ่าน Admin UI — ไม่ต้องแก้โค้ดเพิ่มคำถาม
- **รองรับ field หลายประเภท**: text, textarea, email, tel, number, radio, checkbox, select, rating
- **Validation อัตโนมัติ** ตาม schema ที่กำหนด (จำเป็น, email format, phone format, ช่วงตัวเลข ฯลฯ)
- **Admin Dashboard** — ดูสถิติ, รายการคำตอบ, ลบ, export CSV
- **Auth** — JWT + HttpOnly cookie + bcrypt password
- **Rate limiting** — ป้องกัน spam (20 ครั้ง / 15 นาที / IP สำหรับ submit, 5 ครั้งสำหรับ login)
- **เก็บข้อมูลเป็น JSON file** — ไม่ต้องตั้งค่าฐานข้อมูลแยก

## โครงสร้าง

```
survey-platform/
├── server.js              # Express server + API
├── package.json
├── .env.example
├── data/                  # (gitignored) เก็บข้อมูล
│   └── survey-platform.json
└── public/
    ├── styles.css
    ├── index.html         # landing page
    ├── survey.html        # หน้าตอบแบบสอบถาม (dynamic)
    ├── login.html
    ├── admin.html         # dashboard
    └── admin-survey.html  # ดูคำตอบของ survey แต่ละชุด
```

## เริ่มใช้งาน

```bash
cd survey-platform
npm install
npm start
```

เปิด:
- หน้าแรก: http://localhost:3000/
- Admin: http://localhost:3000/admin
- default login: `admin` / `admin123`

## วิธีใช้

1. login เข้า `/admin`
2. กด **+ สร้างแบบสอบถาม** ตั้งชื่อ เลือก fields กำหนด options
3. ระบบจะสร้าง URL ให้เช่น `/s/customer-satisfaction`
4. ส่ง URL ให้ผู้ตอบ
5. ดูคำตอบ + Export CSV จาก dashboard

## Environment variables

| ตัวแปร | Default | อธิบาย |
|---|---|---|
| `PORT` | `3000` | port ที่ใช้ |
| `JWT_SECRET` | `change-this-...` | secret สำหรับ JWT — **ต้องเปลี่ยนใน production** |
| `ADMIN_USERNAME` | `admin` | username ผู้ดูแลคนแรก |
| `ADMIN_PASSWORD` | `admin123` | password ผู้ดูแลคนแรก |
| `DATA_DIR` | `./data` | โฟลเดอร์เก็บข้อมูล |
| `NODE_ENV` | `development` | `production` จะเปิด secure cookie |

## API

### Public
- `GET /api/surveys/:slug` — ดู schema ของแบบสอบถาม
- `POST /api/surveys/:slug/responses` — ส่งคำตอบ (rate limited)

### Admin (ต้อง login)
- `POST /api/admin/login` / `POST /api/admin/logout`
- `GET /api/admin/stats`
- `GET /api/admin/surveys` — list
- `POST /api/admin/surveys` — create
- `GET /api/admin/surveys/:id` — detail
- `PUT /api/admin/surveys/:id` — update
- `DELETE /api/admin/surveys/:id`
- `GET /api/admin/surveys/:id/responses?page=1&limit=20`
- `GET /api/admin/surveys/:id/export` — CSV (UTF-8 BOM, ภาษาไทยใน Excel ได้)
- `DELETE /api/admin/responses/:id`

## ความปลอดภัย

- Password เก็บเป็น bcrypt hash
- JWT ใน HttpOnly cookie
- Rate limit ทั้ง submit + login
- Validation ทั้ง client + server ตาม schema
- เก็บ IP + User-Agent ไว้สำหรับ audit

## หมายเหตุการ deploy

- เก็บข้อมูลใน `./data/survey-platform.json` — ถ้า deploy บน platform ที่ filesystem ไม่ persist (Railway, Render, Heroku) ต้อง mount volume ไปที่ `./data`
- **ก่อนขึ้น production:** เปลี่ยน `JWT_SECRET`, `ADMIN_PASSWORD` และตั้ง `NODE_ENV=production`
