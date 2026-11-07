import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { pathToFileURL } from "node:url";

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB Connection State
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

//  Database & Collections
const mongoClient = await connectToMongoDB();
const db = mongoClient.db("booknook");

// Collections
const booksCollection = db.collection("add books");       // সব বইয়ের কালেকশন
const borrowsCollection = db.collection("borrow books");   // বরো করা বইয়ের কালেকশন



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
      createdAt: new Date()
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
    const result = await booksCollection.find().sort({ _id: -1 }).limit(6).toArray();
    res.send(result);
  } catch (error) {
    console.error("Error fetching new arrivals:", error);
    res.status(500).send({ message: "Failed to fetch new arrivals" });
  }
});

// 4. Private: Get single book details
app.get("/all-books/:id", async (req, res) => {
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
    const { bookId, borrowerEmail, bookDetails } = req.body;

    if (!bookId || !borrowerEmail) {
      return res.status(400).send({
        success: false,
        message: "bookId and borrowerEmail are required",
      });
    }

    if (!ObjectId.isValid(bookId)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid book id" });
    }

    // No double borrows: one active loan of the same book per borrower.
    const existingLoan = await borrowsCollection.findOne({
      bookId: String(bookId),
      borrowerEmail,
      status: "borrowed",
    });

    if (existingLoan) {
      return res.status(409).send({
        success: false,
        message: "You already have this book borrowed.",
      });
    }

    const book = await booksCollection.findOne({
      _id: new ObjectId(bookId),
    });

    if (!book) {
      return res
        .status(404)
        .send({ success: false, message: "Book not found" });
    }

    const currentAvailable = book.availableCopies ?? book.totalCopies;

    if (currentAvailable <= 0) {
      return res.status(409).send({
        success: false,
        message: "No copies are currently available.",
      });
    }

    // Reserve one copy. The $gt guard keeps concurrent borrows from overselling.
    const availableAfter = currentAvailable - 1;

    if (book.availableCopies === undefined) {
      // Legacy document without the counter yet — seed it.
      await booksCollection.updateOne(
        { _id: book._id },
        { $set: { availableCopies: availableAfter } }
      );
    } else {
      const reservation = await booksCollection.updateOne(
        { _id: book._id, availableCopies: { $gt: 0 } },
        { $inc: { availableCopies: -1 } }
      );

      if (reservation.matchedCount === 0) {
        return res.status(409).send({
          success: false,
          message: "No copies are currently available.",
        });
      }
    }

    const borrowData = {
      ...req.body,
      bookDetails: { ...(bookDetails ?? {}), availableCopies: availableAfter },
      borrowedAt: new Date(),
      status: "borrowed",
    };

    let inserted;

    try {
      inserted = await borrowsCollection.insertOne(borrowData);
    } catch (insertError) {
      // Give the reserved copy back if the loan record couldn't be saved.
      await booksCollection.updateOne(
        { _id: book._id },
        { $inc: { availableCopies: 1 } }
      );
      throw insertError;
    }

    console.log("Book borrowed successfully:", inserted.insertedId);

    res.status(201).send({
      success: true,
      message: "Book borrowed successfully",
      insertedId: inserted.insertedId,
      availableCopies: availableAfter,
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
app.get("/my-borrows", async (req, res) => {
  try {
    const books = await borrowsCollection
      .find()
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

// 7. Return a borrowed book: drop the loan record and put the copy back
app.delete("/my-borrows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res
        .status(404)
        .send({ success: false, message: "Borrow record not found" });
    }

    const record = await borrowsCollection.findOneAndDelete({
      _id: new ObjectId(id),
    });

    if (!record) {
      return res
        .status(404)
        .send({ success: false, message: "Borrow record not found" });
    }

    let availableCopies;

    // Only an active loan puts a copy back — never twice for the same record.
    if (record.status !== "returned" && ObjectId.isValid(record.bookId)) {
      const book = await booksCollection.findOneAndUpdate(
        { _id: new ObjectId(record.bookId) },
        { $inc: { availableCopies: 1 } },
        { returnDocument: "after" }
      );

      availableCopies = book?.availableCopies;
    }

    console.log("Book returned:", id);

    res.send({
      success: true,
      message: "Book returned successfully",
      availableCopies,
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

//8 . private 
app.get("/my-books/:email",async (req, res)=>{
  const {email} = req.para

});

// Error Handling & Server Startup
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
    console.log(` BookNook Server is running at port ${port}`);
  });
}

export default app;