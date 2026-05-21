require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("CRITICAL ERROR: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

const verifyToken = async(req, res, next) => {
  const authHeader = req?.headers.authorization;
  const token = authHeader?.split(" ")[1];
  if(!token){
    return res.status(401).json({message:"Unauthorized"});
  }
  console.log("Received Authorization Header:", token);
try{
  const {payload} = await jwtVerify(token, JWKS);
  console.log("Token successfully verified. Payload:", payload);
   next();
}catch(err){
  return res.status(403).json({message:"Forbidden: Invalid or expired token"});
}
 
};
async function run() {
  try {
    const db = client.db("petversedb");
    const petsCollection = db.collection("pets");
    const requestsCollection = db.collection("adoptionrequests");

    console.log("Connected to MongoDB Database: petversedb");

    app.get("/", (req, res) => {
      res.send("PetVerse API is running perfectly.");
    });

    // PUBLIC ROUTE: GET ALL PETS (WITH SEARCH, FILTER, SORT)

    app.get("/pets", async (req, res) => {
      try {
        const { search, species, sort } = req.query;
        let query = {};

        // Requirement: Search pets by name ($regex)
        if (search) {
          query.petName = { $regex: search, $options: "i" };
        }

        // Requirement: Filter pets by species ($in)
        if (species) {
          const speciesArray = species.split(",").map((s) => s.trim());
          query.species = { $in: speciesArray };
        }

        // Setup sorting structure if requested
        let sortOption = {};
        if (sort === "feeAsc") sortOption.adoptionFee = 1;
        if (sort === "feeDesc") sortOption.adoptionFee = -1;

        const pets = await petsCollection
          .find(query)
          .sort(sortOption)
          .toArray();
        res.send(pets);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch pets" });
      }
    });

    // PRIVATE ROUTE: GET OWNED PETS FOR MY LISTINGS

    app.get("/pets/owner/:ownerId", async (req, res) => {
      try {
        const { ownerId } = req.params;
        const ownerPets = await petsCollection
          .find({ ownerID: ownerId })
          .toArray();
        res.send(ownerPets);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch owner listings" });
      }
    });

    // GET PET BY ID
    app.get("/pets/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).json({ error: "Invalid pet ID format" });

        const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
        if (!pet) return res.status(404).json({ error: "Pet not found" });
        res.send(pet);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch pet details" });
      }
    });

    // CREATE NEW PET LISTING
    app.post("/pets", async (req, res) => {
      try {
        const petDoc = {
          ...req.body,
          status: "Available", // Requirement: Default status value
        };
        const result = await petsCollection.insertOne(petDoc);
        res.status(201).send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to create pet listing" });
      }
    });

    // UPDATE PET LISTING
    app.put("/pets/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).json({ error: "Invalid pet ID" });

        const updatedData = req.body;
        delete updatedData._id;

        const result = await petsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData },
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to update pet data" });
      }
    });

    // DELETE PET LISTING (Cascade deletes associated hanging requests too)
    app.delete("/pets/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ error: "Invalid pet ID" });

        const petResult = await petsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (petResult.deletedCount === 0)
          return res.status(404).send({ error: "Pet already gone" });

        // Clean up requests linked to this dead pet
        await requestsCollection.deleteMany({ petId: id });
        res.send({ message: "Pet and requests deleted successfully" });
      } catch (err) {
        res.status(500).send({ error: "Failed to remove pet record" });
      }
    });

    //  ADOPTION REQUEST OPERATIONS & CONTROLS

    // SUBMIT NEW ADOPTION FORM
    app.post("/adoptionrequests", async (req, res) => {
      try {
        const { petId, request_user, owner_id } = req.body;

        //  Pet owners are not allowed to submit requests
        if (request_user === owner_id) {
          return res.status(400).send({
            error:
              "You cannot submit an adoption request for your own listing.",
          });
        }

        //  Check if pet is already adopted
        const targetPet = await petsCollection.findOne({
          _id: new ObjectId(petId),
        });
        if (!targetPet || targetPet.status === "Adopted") {
          return res.status(400).send({
            error: "This pet has already been adopted by someone else.",
          });
        }

        const requestDoc = {
          ...req.body,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await requestsCollection.insertOne(requestDoc);
        res.status(201).send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to post adoption application" });
      }
    });

    // GET ALL INCOMING ADOPTION APPLICATIONS FOR A SPECIFIC OWNER (Modal helper)
    app.get("/adoptionrequests/owner/:ownerId", async (req, res) => {
      try {
        const { ownerId } = req.params;
        const requests = await requestsCollection
          .find({ owner_id: ownerId })
          .toArray();
        res.send(requests);
      } catch (err) {
        res.status(500).send({ error: "Failed to grab incoming requests" });
      }
    });

    // GET OUTGOING APPLICATIONS SUBMITTED BY A SPECIFIC ADOPTER USER
    app.get("/adoptionrequests/user/:userId", async (req, res) => {
      try {
        const { userId } = req.params;
        const requests = await requestsCollection
          .find({ request_user: userId })
          .toArray();
        res.send(requests);
      } catch (err) {
        res.status(500).send({ error: "Failed to grab outbound requests" });
      }
    });

    // CANCEL OUTBOUND ADOPTION REQUEST BY USER
    app.delete("/adoptionrequests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await requestsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to remove adoption request" });
      }
    });

    // ACTION COMPONENT FOR ADOPTION APPROVAL/REJECTION CONTROLS
    app.patch("/adoptionrequests/:id/status", async (req, res) => {
      try {
        const requestId = req.params.id;
        const { status } = req.body; // Expecting 'approved' or 'rejected'

        if (!ObjectId.isValid(requestId))
          return res.status(400).send({ error: "Invalid Request ID" });

        const targetedRequest = await requestsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!targetedRequest)
          return res.status(404).send({ error: "Request not found" });

        const activePetId = targetedRequest.petId;

        if (status === "approved") {
          // Mark this selected application request as approved
          await requestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status: "approved" } },
          );

          //  Mark the pet status field as Adopted inside the pets collection
          await petsCollection.updateOne(
            { _id: new ObjectId(activePetId) },
            { $set: { status: "Adopted" } },
          );

          //  Prevent further requests by auto-rejecting all remaining pending contenders
          await requestsCollection.updateMany(
            {
              petId: activePetId,
              _id: { $ne: new ObjectId(requestId) },
              status: "pending",
            },
            { $set: { status: "rejected" } },
          );

          return res.send({
            message:
              "Request approved and alternative options closed successfully.",
          });
        } else {
          // Handle negative rejections cleanly
          await requestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status: "rejected" } },
          );
          return res.send({
            message: "Application request formally rejected.",
          });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to balance update workflows" });
      }
    });

    app.listen(port, () => {
      console.log(`Server running flawlessly on port ${port}`);
    });
  } catch (err) {
    console.error("Server initialization error:", err);
  }
}

run();
