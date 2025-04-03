// pages/api/generate-api-key.ts

import type { NextApiRequest, NextApiResponse } from "next";
// Import the server-side auth instance you set up in your project.
// This should be the same instance from your /lib/auth.ts file.
import { auth } from "@/lib/auth";

// This is the API route handler function.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Allow only POST requests.
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Use the Better Auth library to create a new API key.
    // The 'body' object contains the properties as defined in the Better Auth documentation.
    // Make sure to pass the request headers to associate the key with the authenticated user.
    const { data: apiKeyData, error } = await auth.api.createApiKey({
      body: {
        name: "New API Key", // You can customize the name as needed
        expiresIn: 60 * 60 * 24 * 7, // The API key expires in 7 days (in seconds)
        prefix: "my_app", // Customize the prefix to identify your API keys
        metadata: {
          tier: "premium", // Example metadata; adjust as needed
        },
      },
      headers: req.headers, // Pass the headers to connect this API key to a user
    });

    // If there is an error from Better Auth, return it.
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Send back the generated API key.
    // The API key is expected to be in the 'key' property of the returned object.
    return res.status(200).json({ apiKey: apiKeyData.key });
  } catch (err) {
    console.error("Error generating API key:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
