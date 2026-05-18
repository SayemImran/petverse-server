require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
  }),
);

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});



async function run() {
  try {
    const db = client.db("petversedb");
    const petsCollection = db.collection("pets");

    app.get("/", (req, res) => {
      res.send("Welcome to PetVerse API");
    });

    // get all pets
    app.get("/pets", async (req, res) => {
      try {
        const pets = await petsCollection.find().toArray();
        res.send(pets);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch pets" });
      }
    });

    // add a pet
    app.post("/pets", async (req, res) => {
      try {
        const pet = req.body;
        const result = await petsCollection.insertOne(pet);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to add pet" });
      }
    });

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (err) {
    console.error(err);
    await client.close();
  }
}

run();
