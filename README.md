# Booknook Server

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `MONGO_DB_URL` to the MongoDB connection string and `FRONTEND_BASE_URL` to your frontend's origin.
3. Run `npm install` and `npm start`.

The server listens on `PORT` when set, or port `8000` by default.

## Deploy to Vercel

1. Import this repository into Vercel, using the repository root as the project root.
2. In the Vercel project's **Settings > Environment Variables**, set `MONGO_DB_URL` to the MongoDB connection string and `FRONTEND_BASE_URL` to the frontend origin for each environment you deploy to. Use the origin only (for example, `https://your-frontend-domain.vercel.app`, without a trailing slash); the server reads its JWKS from `/api/auth/jwks` on that origin.
3. Make sure your MongoDB Atlas network access rules permit connections from Vercel.
4. Deploy. Vercel detects the Express app exported from `index.js` and deploys it as a function; no `vercel.json` is needed.

Do not commit `.env` or put database credentials in source files.
