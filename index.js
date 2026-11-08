import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { pathToFileURL } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB Connection State
let client;
let connection;


const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).send({ message: "Unauthorized!" });
    }

    const JWKS = createRemoteJWKSet(
      new URL(`${process.env.FRONTEND_BASE_URL}/api/auth/jwks`),
    );

    const { payload } = await jwtVerify(token, JWKS);
    if (typeof payload.email !== "string" || !payload.email) {
      return res.status(401).send({ message: "Unauthorized or Invalid Token!" });
    }

    req.user = payload;

    console.log("Verified Payload:", payload);
    console.log("I am middleware");

    return next(); 
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(401).send({ message: "Unauthorized or Invalid Token!" });
  }
};

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

//  Database & Collections
const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");

// Collections
const booksCollection = db.collection("add books"); 
const borrowsCollection = db.collection("borrow books"); 


app.get("/", (req, res) => {
  res.send({ message: "BookNook Server is running gracefully!" });
});

// 1. Private: Add a new book
app.post("/books", verifyToken, async (req, res) => {
  try {
    const bookData = {
      ...req.body,
      addedBy: {
        name: req.user.name || req.user.email,
        email: req.user.email,
      },
      
      availableCopies: Number(req.body.totalCopies) || 0,
      createdAt: new Date(),
    };
    const result = await booksCollection.insertOne(bookData);
    console.log("Book added:", result.insertedId);
    res.status(201).send({ success: true, result });
  } catch (error) {
    console.error("Error adding book:", error);
    res.status(500).send({ success: false, message: "Failed to add book" });
  }
});

// 2. Public: Get all books
app.get("/books", async (req, res) => {
  try {
    const books = await booksCollection.find().sort({ _id: -1 }).toArray();
    res.send(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// 3. Public: Get the six newest arrivals (For Home Page)
app.get("/books/new-arrivals", async (req, res) => {
  try {
    const result = await booksCollection
      .find()
      .sort({ _id: -1 })
      .limit(6)
      .toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching new arrivals:", error);
    res.status(500).send({ message: "Failed to fetch new arrivals" });
  }
});

// 4. Private: Get single book details
app.get("/books/:id",verifyToken, async (req, res) => {
  try {
    const result = await booksCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!result) {
      return res.status(404).send({ message: "Book not found" });
    }
    res.send({ result });
  } catch (error) {
    console.error("Error fetching book details:", error);
    res.status(500).send({ message: "Failed to fetch book details" });
  }
});

// 5. Private: Borrow a book
app.post("/borrows",verifyToken, async (req, res) => {
  try {
    const { bookId, borrowerEmail } = req.body;

    if (!bookId || !ObjectId.isValid(bookId)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid bookId" });
    }

    if (borrowerEmail && borrowerEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Forbidden" });
    }

    // No double borrows
    const existingLoan = await borrowsCollection.findOne({
      bookId: String(bookId),
      borrowerEmail: req.user.email,
    });

    if (existingLoan) {
      return res.status(409).send({
        success: false,
        message: "You cannot borrow the same book twice at the same time!",
      });
    }

    
    const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });

    if (!book) {
      return res
        .status(404)
        .send({ success: false, message: "Book not found" });
    }

    const currentAvailable = book.availableCopies ?? book.totalCopies;

    if (currentAvailable <= 0) {
      return res.status(400).send({
        success: false,
        message: "Not Available",
      });
    }

    
    const borrowData = {
      ...req.body,
      borrowerEmail: req.user.email,
      borrowerName: req.user.name || req.user.email,
      borrowedAt: new Date(),
      status: "borrowed",
    };
    const inserted = await borrowsCollection.insertOne(borrowData);

    const decrement = await booksCollection.updateOne(
      { _id: new ObjectId(bookId), availableCopies: { $gt: 0 } },
      { $inc: { availableCopies: -1 } },
    );

    if (decrement.matchedCount === 0) {
      await borrowsCollection.deleteOne({ _id: inserted.insertedId });
      return res.status(400).send({
        success: false,
        message: "Not Available",
      });
    }

    console.log("Book borrowed successfully:", inserted.insertedId);
    res.status(201).send({
      success: true,
      message: "Book borrowed successfully",
      insertedId: inserted.insertedId,
    });
  } catch (error) {
    console.error("Error borrowing book:", error);
    res.status(500).send({
      success: false,
      message: "Failed to borrow book",
      error: error.message,
    });
  }
});

// 6.public: Get the authenticated user's borrow records
app.get("/borrows/:email", verifyToken, async (req, res) => {
  const { email } = req.params;
  if (email !== req.user.email) {
    return res.status(403).send({ message: "Forbidden" });
  }

  try {
    const books = await borrowsCollection
      .find({ borrowerEmail: req.user.email })
      .sort({ _id: -1 })
      .toArray();

    res.send(books);
  } catch (error) {
    console.error("Error fetching books:", error);

    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

// 7.private: Delete some data
app.delete("/borrows/:id",verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res
        .status(404)
        .send({ success: false, message: "Borrow record not found" });
    }

    // Find and delete the borrow record
    const record = await borrowsCollection.findOneAndDelete({
      _id: new ObjectId(id),
      borrowerEmail: req.user.email,
    });

    if (!record) {
      return res
        .status(404)
        .send({ success: false, message: "Borrow record not found" });
    }

   
    if (record.bookId && ObjectId.isValid(record.bookId)) {
      await booksCollection.updateOne(
        { _id: new ObjectId(record.bookId) },
        { $inc: { availableCopies: 1 } },
      );
    }

    console.log("Book returned:", id);
    res.send({
      success: true,
      message: "Book returned successfully",
    });
  } catch (error) {
    console.error("Error returning book:", error);
    res.status(500).send({
      success: false,
      message: "Failed to return book",
      error: error.message,
    });
  }
});

// 8.Private: Get the books the authenticated user has cataloged
app.get("/books/user/:email", verifyToken, async (req, res) => {
  if (req.params.email !== req.user.email) {
    return res.status(403).send({ message: "Forbidden" });
  }

  try {
    const books = await booksCollection
      .find({ "addedBy.email": req.user.email })
      .sort({ _id: -1 })
      .toArray();

    res.send(books);
  } catch (error) {
    console.error("Error fetching user books:", error);

    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// 9.Private: Update a cataloged book 
app.patch("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    const { title, author, category, totalCopies, description, imageUrl } = req.body;

    if (!title || !author) {
      return res.status(400).send({ success: false, message: "Title and author are required" });
    }

    const updateDoc = {
      $set: {
        title,
        author,
        category,
        totalCopies: Number(totalCopies) || 1,
        availableCopies: Number(totalCopies) || 1,
        description,
        imageUrl,
      },
    };

    const updated = await booksCollection.findOneAndUpdate(
      { _id: new ObjectId(id), "addedBy.email": req.user.email },
      updateDoc,
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    console.log("Book updated:", id);
    res.send({ success: true, message: "Book updated successfully", result: updated });

  } catch (error) {
    console.error("Error updating book:", error);
    res.status(500).send({
      success: false,
      message: "Failed to update book",
      error: error.message,
    });
  }
});

// 10.Private: Remove a cataloged book
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    const result = await booksCollection.deleteOne({
      _id: new ObjectId(id),
      "addedBy.email": req.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    console.log("Book removed:", id);
    res.send({ success: true, message: "Book removed successfully" });

  } catch (error) {
    console.error("Error removing book:", error);
    res.status(500).send({
      success: false,
      message: "Failed to remove book",
      error: error.message,
    });
  }
});

// Error Handling & Server Startup
app.use((error, req, res, next) => {
  console.error("Request failed:", error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).send({ message: "Internal server error" });
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => {
    console.log(` BookNook Server is running at port ${port}`);
  });
}

export default app;
