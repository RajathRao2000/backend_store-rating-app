import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import roles from "./utils/roles.js";
import googleAuthURIs from "./utils/googleAuthURIs.js";
import axios from "axios";
import cors from "cors";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
const uri = process.env.MONGODB_URI;
const googleApiKey = process.env.GOOGLE_API_KEY;

const SIGNINURL = `${googleAuthURIs.SignInUrl}${googleApiKey}`;
const SIGNUP_URL = `${googleAuthURIs.SignUpUrl}${googleApiKey}`;
const password_reset_url = `${googleAuthURIs.ChangePassword}${googleApiKey}`;

let client;
let db;
async function connectToDatabase() {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db("StoresRatingApp");
  }
  return client;
}
connectToDatabase();
app.get("/data-stats", async (req, res) => {
  try {
    const usersCount = await db.collection("users").countDocuments();
    const storesCount = await db
      .collection("users")
      .countDocuments({ role: roles.STOREOW });
    const submittedRatings = await db.collection("ratings").countDocuments();

    res.status(200).json({
      message: "success",
      counts: { usersCount, storesCount, submittedRatings },
    });
  } catch (error) {
    console.error("Error in counts:", error.message || error);
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/sign-in", async (req, res) => {
  const { email, password } = req.body;
  try {
    const collection = await db.collection("users");
    console.log("collection", collection);
    const userInfo = await collection.findOne({ email });

    const result = await axios.post(SIGNINURL, {
      email,
      password,
      returnSecureToken: true,
    });
    res.status(200).json({
      message: "success",
      data: result.data,
      userData: userInfo,
    });
  } catch (error) {
    console.error("Error in backend sign-in API:", error);
    res.status(200).json({
      message: "error",
      data:
        error.response?.data?.error?.message ||
        error.message ||
        "An error occurred",
    });
  }
});

app.post("/sign-up", async (req, res) => {
  const body = { ...req.body };
  const { email, password, name, address } = req.body;
  try {
    const collection = await db.collection("users");
    const result = await axios.post(SIGNUP_URL, {
      email,
      password,
      returnSecureToken: true,
    });
    delete body.password;
    if (body.role != roles.STOREOW) {
      delete body.store_name;
      delete body.overall_rating;
    }
    if (result.status == 200) {
      const mongoDB_result = await collection.insertOne({ ...body });
      res.status(200).json({ message: "success", data: result.data });
    }
  } catch (error) {
    console.error("Error in backend sign-up API:", error.message || error);
    res.status(200).json({
      message: "error",
      data: error.response?.data?.error?.message || "An error occurred",
    });
  }
});

app.post("/store-list", async (req, res) => {
  const { "arrange-by": arrangeBy, "sort-by": sortBy } = req.body;
  try {
    const collection = await db.collection("users");

    const query = { role: roles.STOREOW };
    const sortOrder = sortBy === "ascending" ? 1 : -1;
    const dblist = await collection
      .find(query)
      .sort({ [arrangeBy]: sortOrder })
      .toArray();

    res.status(200).json({ message: "success", storesList: dblist });
  } catch (error) {
    console.error("Error in backend get stores:", error.message || error);
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/user-list", async (req, res) => {
  const { "arrange-by": arrangeBy, "sort-by": sortBy, role } = req.body;
  try {
    const collection = await db.collection("users");
    const query = role && role !== "all" ? { role } : {};
    const sortOrder = sortBy === "ascending" ? 1 : -1;
    const dblist = await collection
      .find(query)
      .sort({ [arrangeBy]: sortOrder })
      .toArray();

    res.status(200).json({ message: "success", usersList: dblist });
  } catch (error) {
    console.error(
      "Error in backend get user list API:",
      error.message || error
    );
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    const { idToken, newPassword } = req.body;
    const result = await axios.post(password_reset_url, {
      idToken,
      password: newPassword,
      returnSecureToken: true,
    });
    res.status(200).json({ message: "success", data: result.data });
  } catch (error) {
    console.error(
      "Error in backend reset-password API:",
      error.message || error
    );
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/get-user-rating", async (req, res) => {
  try {
    const { store_name, user_name, name } = req.body;
    console.log(req.body);

    const collection = await db.collection("ratings");
    let query = { user_name, store_name, name };
    let ratingInfo = await collection.findOne(query);
    console.log("rating", ratingInfo);
    res.status(200).json({ message: "success", ratingInfo });
  } catch (error) {
    console.error(
      "Error in backend get-user-rating API:",
      error.message || error
    );
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/submit-rating", async (req, res) => {
  try {
    const { store_name, user_name, name, rating } = req.body;

    const collection = await db.collection("ratings");
    let query = { user_name, store_name, name };
    let ratingInfo = await collection.findOne(query);
    let result;
    if (ratingInfo != null) {
      result = await collection.updateOne(
        { _id: ratingInfo._id },
        { $set: { rating } }
      );
    } else {
      result = await collection.insertOne({
        store_name,
        user_name,
        name,
        rating,
      });
    }
    let calculateAverage = await collection
      .aggregate([
        { $match: { store_name } },
        {
          $group: {
            _id: "$store_name",
            averageRating: { $avg: "$rating" },
          },
        },
      ])
      .toArray();
    const overall_rating = calculateAverage[0].averageRating;
    const updateAverage = await db
      .collection("users")
      .updateOne({ store_name, name }, { $set: { overall_rating } });
    res.status(200).json({ message: "success", result });
  } catch (error) {
    console.error(
      "Error in backend submit-rating API:",
      error.message || error
    );
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.post("/store-stats", async (req, res) => {
  try {
    const collection = await db.collection("users");
    const query = { email: req.body.email };
    const user = await collection.findOne(query);
    const listofusers = await db
      .collection("ratings")
      .find({ name: req.body.name })
      .toArray();
    res.status(200).json({
      message: "success",
      rating: user.overall_rating,
      userList: listofusers,
    });
  } catch (error) {
    console.error("Error in backend store-stats API:", error.message || error);
    res
      .status(200)
      .json({ message: "error", data: error.message || "An error occurred" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
