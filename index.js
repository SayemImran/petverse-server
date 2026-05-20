require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
    const requestsCollection = db.collection("adoptionrequests"); 

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

    // get pet by id
    app.get("/pets/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ error: "Invalid pet ID" });
        }
        const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
        if (!pet) {
          return res.status(404).send({ error: "Pet not found" });
        }
        res.send(pet);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch pet" });
      }
    });

    // add a pet
    app.post("/pets", async (req, res) => {
      try {
        const pet = req.body;
        const result = await petsCollection.insertOne(pet);
        res.status(201).send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to add pet" });
      }
    });



    // submit adoption request
    app.post("/adoptionrequests", async (req, res) => {
      try {
        const { request_user, owner_id } = req.body;

        if (!request_user || !owner_id) {
          return res
            .status(400)
            .send({ error: "request_user and owner_id are required" });
        }

        const requestDoc = {
          ...req.body,
          status: "pending", // default status
          createdAt: new Date(),
        };

        const result = await requestsCollection.insertOne(requestDoc);
        res.status(201).send(result);
      } catch (err) {
        console.error("Failed to save request:", err);
        res.status(500).send({ error: "Failed to save adoption request" });
      }
    });

    // get all requests for a specific owner for my listings route
    app.get("/adoptionrequests/owner/:ownerId", async (req, res) => {
      try {
        const { ownerId } = req.params;
        const requests = await requestsCollection
          .find({ owner_id: ownerId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(requests);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch requests" });
      }
    });

    // get all requests made by a specific user for My request route in Frontend
    app.get("/adoptionrequests/user/:userId", async (req, res) => {
      try {
        const { userId } = req.params;
        const requests = await requestsCollection
          .find({ request_user: userId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(requests);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch requests" });
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
