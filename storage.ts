import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

/**
 * Object Storage Utility for Backblaze B2 / S3-compatible storage.
 * Handles uploading base64 images and returning their public URLs.
 */

const bucketName = process.env.MEDIA_BUCKET_NAME;
const bucketEndpoint = process.env.MEDIA_BUCKET_URL;
const accessKeyId = process.env.MEDIA_BUCKET_KEY;
const secretAccessKey = process.env.MEDIA_BUCKET_SECRET;

if (!bucketName || !bucketEndpoint || !accessKeyId || !secretAccessKey) {
  console.warn("⚠️ Object storage environment variables are missing. Uploads will fail.");
}

const s3Client = new S3Client({
  region: "us-east-1", // Backblaze B2 ignores this, but AWS SDK requires it
  endpoint: bucketEndpoint,
  credentials: {
    accessKeyId: accessKeyId || "",
    secretAccessKey: secretAccessKey || "",
  },
  forcePathStyle: true, // Required for Backblaze B2 and some S3-compatible endpoints
});

/**
 * Uploads a base64 image string to the configured S3-compatible bucket.
 * @param base64String The full data URL string (e.g., "data:image/jpeg;base64,...")
 * @returns The public URL of the uploaded object.
 */
export async function uploadBase64Image(base64String: string): Promise<string> {
  if (!bucketName || !bucketEndpoint) {
    throw new Error("Object storage is not configured. Please check MEDIA_BUCKET_* environment variables.");
  }

  // Parse the base64 string
  const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 image string provided to uploadBase64Image");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");

  // Determine file extension
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const fileName = `creations/${Date.now()}-${uuidv4()}.${extension}`;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: buffer,
        ContentType: mimeType,
        // Backblaze B2 public buckets don't strictly need ACL, but this is standard
        ACL: "public-read",
      })
    );

    // Construct the public URL
    // For Backblaze B2 virtual-hosted style: https://<bucket-name>.s3.<region>.backblazeb2.com/<key>
    // Since we use forcePathStyle, the endpoint is like https://s3.region.backblazeb2.com
    // The public URL is typically: https://<bucket-name>.s3.<region>.backblazeb2.com/<key>
    // Let's build it dynamically based on the endpoint.
    const url = new URL(bucketEndpoint);
    const publicUrl = `${url.protocol}//${bucketName}.${url.host}/${fileName}`;

    console.log(`✅ Successfully uploaded ${fileName} to object storage.`);
    return publicUrl;
  } catch (error: any) {
    console.error("❌ Failed to upload image to object storage:", error);
    throw new Error(`Object storage upload failed: ${error.message}`);
  }
}
