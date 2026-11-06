# Booknook Server

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `MONGO_DB_URL` to the MongoDB connection string.
3. Run `npm install` and `npm start`.

The server listens on `PORT` when set, or port `8000` by default.

## Deploy to Vercel

1. Import this repository into Vercel.
2. In the Vercel project's **Settings → Environment Variables**, set `MONGO_DB_URL` to the MongoDB connection string for each environment you deploy to.
3. Make sure your MongoDB Atlas network access rules permit connections from Vercel.
4. Deploy. Vercel detects the Express app exported from `index.js` and deploys it as a function.

Do not commit `.env` or put database credentials in source files.
