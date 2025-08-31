const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const port = 5000;

// ✅ If you also want to allow custom headers explicitly:
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Allow all origins
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

app.use(express.json()); // so backend can read JSON body

const SESSION_FILE = path.join(__dirname, "session.json");
const baseUrl = "https://www.instagram.com/api/v1/friendships/";

// Helpers
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function saveSession(session) {
  await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
}
async function loadSession() {
  try {
    const data = await fs.readFile(SESSION_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Step 1: Login
async function instagramLogin(username, password) {
  try {
    const homepage = await axios.get(
      "https://www.instagram.com/accounts/login/"
    );

    const csrfToken = homepage.headers["set-cookie"]
      .find((c) => c.includes("csrftoken"))
      .split(";")[0]
      .split("=")[1];

    const loginRes = await axios.post(
      "https://www.instagram.com/accounts/login/ajax/",
      new URLSearchParams({
        username,
        enc_password: `#PWD_INSTAGRAM_BROWSER:0:${Date.now()}:${password}`,
        queryParams: "{}",
        optIntoOneTap: "false",
      }),
      {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-csrftoken": csrfToken,
          "x-requested-with": "XMLHttpRequest",
        },
      }
    );

    if (!loginRes.data.authenticated) {
      throw new Error("Invalid username or password");
    }

    const setCookies = loginRes.headers["set-cookie"];
    const sessionid = setCookies
      .find((c) => c.includes("sessionid"))
      .split(";")[0]
      .split("=")[1];
    const newCsrf = setCookies
      .find((c) => c.includes("csrftoken"))
      .split(";")[0]
      .split("=")[1];
    const ds_user_id = setCookies
      .find((c) => c.includes("ds_user_id"))
      .split(";")[0]
      .split("=")[1];

    const session = { username, sessionid, csrftoken: newCsrf, ds_user_id };
    await saveSession(session);

    console.log(`✅ Logged in as ${username}`);
    return session;
  } catch (err) {
    console.error("❌ Login failed:", err.response?.data || err.message);
    return null;
  }
}

// Step 2: Ensure valid session
async function getSession(username, password) {
  let session = await loadSession();
  if (!session || session.username !== username) {
    session = await instagramLogin(username, password);
  }
  return session;
}

// Step 3: Fetch followers
async function fetchFollowers(username, password, userId, maxId = null, count = 50) {
  let followers = [];
  let currentMaxId = maxId;
  let followerCount = 0;

  const session = await getSession(username, password);
  if (!session) throw new Error("Unable to authenticate.");

  while (true) {
    try {
      const url = `${baseUrl}${userId}/followers/?count=${count}${
        currentMaxId ? `&max_id=${currentMaxId}` : ""
      }&search_surface=follow_list_page`;

      const response = await axios.get(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-csrftoken": session.csrftoken,
          "x-ig-app-id": "936619743392459",
          "x-ig-www-claim": "0",
          referer: `https://www.instagram.com/${username}/followers/`,
          accept: "application/json",
          cookie: `sessionid=${session.sessionid}; csrftoken=${session.csrftoken}; ds_user_id=${session.ds_user_id};`,
        },
      });

      if (response.status !== 200 || response.data.status === "fail") {
        throw new Error(response.data.message || "Request failed");
      }

      const usersWithCount = response.data.users.map((user) => {
        followerCount += 1;
        return { username: user.username, count: followerCount };
      });

      followers = followers.concat(usersWithCount);
      currentMaxId = response.data.next_max_id;

      if (!currentMaxId) break;

      await delay(2000);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log("⚠️ Session expired. Re-logging in...");
        await instagramLogin(username, password);
        return fetchFollowers(username, password, userId, currentMaxId, count);
      }

      if (
        error.response?.data?.message ===
        "Please wait a few minutes before you try again."
      ) {
        throw new Error("⏳ Rate limit hit. Try again later.");
      }
      throw error;
    }
  }

  return followers;
}

// Express API
app.post("/followers", async (req, res) => {
  const { username, password, userId } = req.body;
  const maxId = req.query.maxId || null;
  const count = parseInt(req.query.count) || 50;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password required" });
  }

  try {
    const followers = await fetchFollowers(username, password, userId, maxId, count);
    res.json({
      success: true,
      followers,
      count: followers.length,
      next_max_id: maxId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
