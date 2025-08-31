const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const port = 3000;

// Instagram credentials (apna username/password daal do)
const IG_USERNAME = "abhiishekkjain";
const IG_PASSWORD = "abhishek111u";

const SESSION_FILE = path.join(__dirname, "session.json");
const baseUrl = "https://www.instagram.com/api/v1/friendships/";

// Helper: Delay to avoid rate limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Save session to file
async function saveSession(session) {
  await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
}

// Helper: Load session from file
async function loadSession() {
  try {
    const data = await fs.readFile(SESSION_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Step 1: Login to Instagram & fetch cookies
async function instagramLogin() {
  try {
    // 1. Get CSRF token
    const homepage = await axios.get(
      "https://www.instagram.com/accounts/login/"
    );
    console.log(homepage, "homepage");
    const csrfToken = homepage.headers["set-cookie"]
      .find((c) => c.includes("csrftoken"))
      .split(";")[0]
      .split("=")[1];

    // 2. Login request
    const loginRes = await axios.post(
      "https://www.instagram.com/accounts/login/ajax/",
      new URLSearchParams({
        username: IG_USERNAME,
        enc_password: `#PWD_INSTAGRAM_BROWSER:0:${Date.now()}:${IG_PASSWORD}`,
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

    const session = { sessionid, csrftoken: newCsrf, ds_user_id };
    await saveSession(session);

    console.log("✅ Logged in successfully, session saved.");
    return session;
  } catch (err) {
    console.error("❌ Login failed:", err.response?.data || err.message);
    return null;
  }
}

// Step 2: Ensure valid session (load from file or login again)
async function getSession() {
  let session = await loadSession();
  if (!session) {
    session = await instagramLogin();
  }
  return session;
}

// Step 3: Fetch followers with pagination
async function fetchFollowers(userId, maxId = null, count = 50) {
  let followers = [];
  let currentMaxId = maxId;
  let followerCount = 0;

  const session = await getSession();
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
          "x-ig-www-claim": "0", // usually dynamic, but 0 works after login
          referer: `https://www.instagram.com/${IG_USERNAME}/followers/`,
          accept: "application/json",
          cookie: `sessionid=${session.sessionid}; csrftoken=${session.csrftoken}; ds_user_id=${session.ds_user_id};`,
        },
      });

      if (response.status !== 200 || response.data.status === "fail") {
        throw new Error(response.data.message || "Request failed");
      }

      const usersWithCount = response.data.users.map((user) => {
        followerCount += 1;
        return { ...user, count: followerCount };
      });

      followers = followers.concat(usersWithCount);
      currentMaxId = response.data.next_max_id;

      console.log(
        `Fetched ${response.data.users.length} followers, next_max_id: ${currentMaxId}`
      );

      if (!currentMaxId) {
        console.log("✅ No more pages.");
        break;
      }

      await delay(2000);
    } catch (error) {
      console.error(
        "❌ Error fetching followers:",
        error.response?.data || error.message
      );

      if (error.response?.status === 401) {
        console.log("⚠️ Session expired. Re-logging in...");
        await instagramLogin();
        return fetchFollowers(userId, currentMaxId, count);
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

// Express route
app.get("/followers", async (req, res) => {
  const userId = req.query.userId || "48109394214"; // Default userId
  const maxId = req.query.maxId || null;
  const count = parseInt(req.query.count) || 50;

  try {
    const followers = await fetchFollowers(userId, maxId, count);
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
