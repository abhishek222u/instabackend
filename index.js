const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;

const app = express();
const port = 3000;

// Instagram private API configuration
const baseUrl = "https://www.instagram.com/api/v1/friendships/";
const headers = {
  "x-csrftoken": "fG56UHeTGnCAPljEzwCQxXIGjxxlJsYD",
  "x-ig-app-id": "936619743392459",
  "x-ig-www-claim": "hmac.AR3I3p0ippw8Rv1u2yhANDNjWCWmgwvW3V3M_ZodzHEKHKuK",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  referer: "https://www.instagram.com/abhiishekkjain/followers/",
  accept: "application/json",
};
const cookies = {
  ig_nrcb: "1",
  datr: "i5x6aEh1GMrykZOwDRfrf1kI",
  ig_did: "D87CFF31-C53B-4FF4-A63D-21F6BC32AD40",
  ps_l: "1",
  ps_n: "1",
  mid: "aH5o-QALAAHIiNfHyacn1r1d8AeL",
  csrftoken: "fG56UHeTGnCAPljEzwCQxXIGjxxlJsYD", // Replace with fresh csrftoken
  sessionid:
    "48109394214%3AWCWXDpZmxYuQlN%3A17%3AAYcuMx9Liq3eCTOeaDpSw09E4jH_IHc9wqtiX-935w", // Replace with fresh sessionid
  ds_user_id: "48109394214",
  rur: "CCO,48109394214,1787580410:01fe19aff5386865e0501bf4692034dce312e20479ac7ad64f9c26c268b861a3a96ccfa6",
};

// Helper function to introduce delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to fetch followers with pagination
async function fetchFollowers(userId, maxId = null, count = 50) {
  let followers = [];
  let currentMaxId = maxId;
  let followerCount = 0;

  while (true) {
    try {
      const url = `${baseUrl}${userId}/followers/?count=${count}${
        currentMaxId ? `&max_id=${currentMaxId}` : ""
      }&search_surface=follow_list_page`;
      const response = await axios.get(url, {
        headers,
        withCredentials: true,
        headers: {
          ...headers,
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      });

      if (response.status !== 200 || response.data.status === "fail") {
        throw new Error(response.data.message || "Request failed");
      }

      // Add count property to each follower object
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
        console.log("No more pages");
        break;
      }

      // Delay to avoid rate-limiting (2 seconds)
      await delay(2000);
    } catch (error) {
      console.error("Error fetching followers:", error.message);
      if (
        error.response?.data?.message ===
        "Please wait a few minutes before you try again."
      ) {
        throw new Error("Rate limit hit. Please wait and try again later.");
      }
      throw error;
    }
  }

  return followers;
}

// Express route to get followers
app.get("/followers", async (req, res) => {
  const userId = req.query.userId || "48109394214"; // Default to provided userId
  const maxId = req.query.maxId || null; // Optional max_id for specific page
  const count = parseInt(req.query.count) || 50; // Default to 50 followers per request

  try {
    const followers = await fetchFollowers(userId, maxId, count);

    // Optionally save to file
    // await fs.writeFile("followers.json", JSON.stringify(followers, null, 2));
    console.log("Followers saved to followers.json");

    res.json({
      success: true,
      followers: followers,
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

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
