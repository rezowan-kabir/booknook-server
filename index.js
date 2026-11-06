import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

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

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");
const addBookCollection = db.collection("add books");

// Private: Add a new book
app.post("/add-book", async (req, res) => {
  const data = req.body;
  const result = await addBookCollection.insertOne(data);
  console.log(result);
  res.send(result);
});

//private: details page
app.get('/all-books/:id', async(req, res) =>{
    const {id} = req.params
    const result = await addBookCollection.findOne({_id: new ObjectId(id)})
    console.log(result)
    res.send({result})
})

// Public: Get all books (Newest books first / Descending order)
app.get("/all-books", async (req, res) => {
  try {
    // .sort({ _id: -1 }) 
    const books = await addBookCollection.find().sort({ _id: -1 }).toArray();
    res.send(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

app.get("/", (req, res) => {
  res.send({ message: "Server is running fine!" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
