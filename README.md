# TabZale Backend

## Setup
1. Copy `.env.example` to `.env` and fill credentials (MongoDB URI and Cloudinary keys, admin user/pass).
2. Install dependencies:
   ```
   npm install
   ```
3. Start:
   ```
   npm run dev
   ```

## Endpoints
- `POST /api/users` -> Create user (multipart/form-data)
  - fields: `firstName`, `lastName`, `dob` (YYYY-MM-DD or DD/MM/YYYY), `cedula`, `team`
  - files: `idImage` (image), `selfieImage` (image)
- `GET /api/users/export` -> Download XLSX with embedded images
  - Protected with Basic Auth using ADMIN_USER and ADMIN_PASS from .env

