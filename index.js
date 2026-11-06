import express from 'express'
import { MongoClient } from "mongodb";
import 'dotenv/config'
const app = express();
const PORT = 8000;



const client = new MongoClient(process.env.MONGO_DB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

connectToMongoDB()


app.get("/", (req, res) => {
  res.send({massage: 'Server is running fine!'});
});

app.listen(PORT, () => {
  console.log(`Server in running at ${PORT}`);
});
