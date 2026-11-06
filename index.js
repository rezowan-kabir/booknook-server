import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { pathToFileURL } from "node:url";

const app = express();

app.use(cors());
app.use(express.json());

let client;
let connection;

export async function connectToMongoDB() {
  const mongoUrl = process.env.MONGO_DB_URL;
  if (!mongoUrl) {
    throw new Error("MONGO_DB_URL environment variable is required");
  }

  if (!client) {
    client = new MongoClient(mongoUrl);
  }

  if (!connection) {
    connection = client.connect().catch((error) => {
      connection = undefined;
      throw error;
    });
  }

  await connection;
  return client;
}

async function getAddBookCollection() {
  const mongoClient = await connectToMongoDB();
  return mongoClient.db("booknook").collection("add books");
}

// Private: Add a new book
app.post("/add-book", async (req, res) => {
  const addBookCollection = await getAddBookCollection();
  const result = await addBookCollection.insertOne(req.body);
  console.log(result);
  res.send(result);
});

//private: details page
app.get("/all-books/:id", async (req, res) => {
  const addBookCollection = await getAddBookCollection();
  const result = await addBookCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  console.log(result);
  res.send({ result });
});

// Public: Get all books (Newest books first / Descending order)
app.get("/all-books", async (req, res) => {
  try {
    const addBookCollection = await getAddBookCollection();
    const books = await addBookCollection.find().sort({ _id: -1 }).toArray();
    res.send(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// Public: Get the six newest arrivals
app.get("/new-arrivals", async (req, res) => {
  const addBookCollection = await getAddBookCollection();
  const result = await addBookCollection.find().limit(6).toArray();
  res.send(result);
});

app.get("/", (req, res) => {
  res.send({ message: "Server is running fine!" });
});

app.use((error, req, res, next) => {
  console.error("Request failed:", error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).send({ message: "Internal server error" });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
}

export default app;
