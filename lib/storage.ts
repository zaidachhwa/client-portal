import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

// Private object storage (§10.6). Cloudinary when CLOUDINARY_URL is set, local disk otherwise (dev/seed).
// Stored keys say where the bytes live: "cloudinary:<public_id>" or a bare local path, so both can coexist.
// Always ./storage (a Docker volume in production). A fixed folder lets the build trace only this directory
// instead of copying the whole project into the server bundle.
const ROOT = path.join(process.cwd(), "storage");
const local = (key: string) => {
  const file = path.join(process.cwd(), "storage", key);
  if (!file.startsWith(ROOT + path.sep)) throw new Error("Bad storage key");
  return file;
};
const CLOUD = "cloudinary:";
const cloudEnabled = () => !!process.env.CLOUDINARY_URL; // the SDK reads credentials from this variable

// Keys are built from ObjectIds and a version number only, never from user-supplied names.
export const storageKey = (orgId: string, documentId: string, version: number) => `${orgId}/${documentId}/${version}`;

export async function putFile(key: string, data: Buffer, ext: string): Promise<string> {
  if (!cloudEnabled()) {
    const file = local(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    return key;
  }
  // "authenticated" delivery: the asset has no public URL; it's only reachable through signed URLs we mint.
  const publicId = `client-portal/${key}${ext ? `.${ext}` : ""}`;
  await new Promise((resolve, reject) =>
    cloudinary.uploader
      .upload_stream({ public_id: publicId, resource_type: "raw", type: "authenticated", overwrite: false }, (err, res) => (err ? reject(err) : resolve(res)))
      .end(data),
  );
  return CLOUD + publicId;
}

export async function getFile(key: string): Promise<Buffer> {
  if (key.startsWith(CLOUD)) {
    // One-minute signed URL, fetched server-side so the browser never sees a Cloudinary link.
    const url = cloudinary.utils.private_download_url(key.slice(CLOUD.length), "", {
      resource_type: "raw", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(local(key));
}

// Used by retention and tenant deletion (§17). Missing files are fine: the goal is that they're gone.
export async function deleteFile(key: string) {
  if (key.startsWith(CLOUD)) {
    await cloudinary.uploader.destroy(key.slice(CLOUD.length), { resource_type: "raw", type: "authenticated", invalidate: true });
    return;
  }
  await rm(local(key), { force: true });
}
