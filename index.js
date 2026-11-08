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
const booksCollection = db.collection("add books"); // সব বইয়ের কালেকশন
const borrowsCollection = db.collection("borrow books"); // বরো করা বইয়ের কালেকশন

// Root route
app.get("/", (req, res) => {
  res.send({ message: "BookNook Server is running gracefully!" });
});

// 1. Private: Add a new book
app.post("/add-book", async (req, res) => {
  try {
    const bookData = {
      ...req.body,
      // Every book starts with all of its copies on the shelf.
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

// 2. Public: Get all books (Newest books first / Descending order)
app.get("/all-books", async (req, res) => {
  try {
    const books = await booksCollection.find().sort({ _id: -1 }).toArray();
    res.send(books);
  } catch (error) {
    console.error("Error fetching books:", error);
    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// 3. Public: Get the six newest arrivals (For Home Page)
app.get("/new-arrivals", async (req, res) => {
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
app.get("/all-books/:id",verifyToken, async (req, res) => {
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

// 5. Public: Borrow a book
app.post("/my-borrows", async (req, res) => {
  try {
    const { bookId, borrowerEmail } = req.body;

    if (!bookId || !borrowerEmail || !ObjectId.isValid(bookId)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid bookId or borrowerEmail" });
    }

    // No double borrows: check if user already borrowed this book
    const existingLoan = await borrowsCollection.findOne({
      bookId: String(bookId),
      borrowerEmail,
    });

    if (existingLoan) {
      return res.status(409).send({
        success: false,
        message: "You cannot borrow the same book twice at the same time!",
      });
    }

    // Check if book exists and has available copies
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

    // Save borrow record
    const borrowData = {
      ...req.body,
      borrowedAt: new Date(),
      status: "borrowed",
    };
    const inserted = await borrowsCollection.insertOne(borrowData);

    // Decrease available copies by 1
    await booksCollection.updateOne(
      { _id: new ObjectId(bookId) },
      { $inc: { availableCopies: -1 } },
    );

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

// 6. Get all borrowed books
app.get("/my-borrow/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const books = await borrowsCollection
      .find({ borrowerEmail: email })
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

// const session = await auth.api.getSession({
//   headers: await headers(),
// });
// const user = session?.user;
// const res = await fetch(`http://localhost:8000/my-books/${user?.email}`);

// 7. Return a borrowed book: drop the loan record and put the copy back
app.delete("/my-borrows/:id", async (req, res) => {
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
    });

    if (!record) {
      return res
        .status(404)
        .send({ success: false, message: "Borrow record not found" });
    }

    // Increase the book's available copies back by 1
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

//8 . private : my books page
app.get("/my-books/:email", async (req, res) => {
  const { email } = req.params;
  const result = await booksCollection
    .find({ "addedBy.email": email })
    .sort({ _id: -1 })
    .toArray();
  res.send(result);
});

//http://localhost:8000/my-books
// 8. Get the books a specific user has cataloged
app.get("/my-books/:email", async (req, res) => {
  try {
    const books = await booksCollection
      .find({ "addedBy.email": req.params.email })
      .sort({ _id: -1 })
      .toArray();

    res.send(books);
  } catch (error) {
    console.error("Error fetching user books:", error);

    res.status(500).send({ message: "Failed to fetch books" });
  }
});

// 9. Update a cataloged book (Simplified)
app.put("/my-books/:id", async (req, res) => {
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

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    console.log("Book updated:", id);
    res.send({ success: true, message: "Book updated successfully" });

  } catch (error) {
    console.error("Error updating book:", error);
    res.status(500).send({
      success: false,
      message: "Failed to update book",
      error: error.message,
    });
  }
});

// 10. Remove a cataloged book (Simplified)
app.delete("/my-books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ success: false, message: "Book not found" });
    }

    const result = await booksCollection.deleteOne({
      _id: new ObjectId(id),
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
