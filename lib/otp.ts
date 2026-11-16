import "server-only";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Types } from "mongoose";
import { sendMail } from "./mail";
import { OtpChallenge, TrustedDevice } from "./models";
import { cookieOptions, sha256 } from "./session";

// Email sign-in codes. A new browser (and every platform admin sign-in) must enter a 6-digit code after the password.
const OTP_COOKIE = "otp";
const DEVICE_COOKIE = "tdev";
const CODE_TTL_MS = 10 * 60 * 1000;
const TRUST_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
export const RESEND_AFTER_MS = 30 * 1000;

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
// The code is hashed with the browser's token, so a leaked hash can't be checked offline without the cookie.
const hashCode = (token: string, code: string) => sha256(`${token}:${code}`);

export const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

async function mailCode(email: string, firstName: string, code: string) {
  // Local development without working mail: the code still reaches the developer.
  if (process.env.NODE_ENV !== "production") console.info(`[otp:dev] sign-in code for ${email}: ${code}`);
  return sendMail(email, `${code} is your Zenova sign-in code`, [
    `Hi ${firstName}, use this code to finish signing in:`,
    code,
    "It expires in 10 minutes. If you didn't try to sign in, change your password; someone may know it.",
  ]);
}

export async function isTrustedDevice(userId: Types.ObjectId) {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return !!token && !!(await TrustedDevice.exists({ userId, tokenHash: sha256(token), expiresAt: { $gt: new Date() } }));
}

// After a correct password. Returns whether the email went out; in production a failed send cancels the challenge.
export async function startChallenge(
  user: { _id: Types.ObjectId; email: string; firstName: string },
  membershipId: Types.ObjectId | undefined,
  platformAdmin: boolean,
) {
  const token = randomBytes(32).toString("base64url");
  const code = newCode();
  await OtpChallenge.deleteMany({ userId: user._id }); // only the latest code works
  const challenge = await OtpChallenge.create({
    userId: user._id, membershipId, platformAdmin, tokenHash: sha256(token), codeHash: hashCode(token, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  const mail = await mailCode(user.email, user.firstName, code);
  if (!mail.sent && process.env.NODE_ENV === "production") {
    await challenge.deleteOne();
    return false;
  }
  (await cookies()).set(OTP_COOKIE, token, cookieOptions(CODE_TTL_MS / 1000));
  return true;
}

export const resendWaitSeconds = (lastSentAt: Date) => Math.max(0, Math.ceil((RESEND_AFTER_MS - (Date.now() - lastSentAt.getTime())) / 1000));

// The challenge this browser is in the middle of, if any.
export async function currentChallenge() {
  const token = (await cookies()).get(OTP_COOKIE)?.value;
  if (!token) return null;
  const challenge = await OtpChallenge.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  return challenge ? { token, challenge } : null;
}

export async function resendCode(user: { email: string; firstName: string }) {
  const current = await currentChallenge();
  if (!current) return { error: "That code expired. Sign in again." };
  const { token, challenge } = current;
  if (challenge.sends >= MAX_SENDS) return { error: "Too many codes sent. Sign in again in a few minutes." };
  const wait = RESEND_AFTER_MS - (Date.now() - challenge.lastSentAt.getTime());
  if (wait > 0) return { error: `You can ask for a new code in ${Math.ceil(wait / 1000)} seconds.` };
  const code = newCode();
  challenge.set({ codeHash: hashCode(token, code), attempts: 0, sends: challenge.sends + 1, lastSentAt: new Date(), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  await challenge.save();
  const mail = await mailCode(user.email, user.firstName, code);
  if (!mail.sent && process.env.NODE_ENV === "production") return { error: "We couldn't send the email. Try again in a minute." };
  (await cookies()).set(OTP_COOKIE, token, cookieOptions(CODE_TTL_MS / 1000));
  return {};
}

// Checks the code. On success the challenge is consumed and, if asked, this browser is trusted for 30 days.
export async function checkCode(code: string, trust: boolean) {
  const current = await currentChallenge();
  if (!current) return { error: "That code expired. Sign in again." } as const;
  const { token, challenge } = current;
  // Count the attempt before comparing, so parallel guesses can't exceed the limit.
  const counted = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!counted) return { error: "Too many wrong codes. Sign in again to get a new one." } as const;
  const a = Buffer.from(hashCode(token, code));
  const b = Buffer.from(counted.codeHash);
  if (!/^\d{6}$/.test(code) || a.length !== b.length || !timingSafeEqual(a, b)) {
    const left = MAX_ATTEMPTS - counted.attempts;
    return { error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Sign in again to get a new one." } as const;
  }

  await counted.deleteOne();
  const jar = await cookies();
  jar.delete(OTP_COOKIE);
  if (trust && !counted.platformAdmin) {
    const deviceToken = randomBytes(32).toString("base64url");
    await TrustedDevice.create({ userId: counted.userId, tokenHash: sha256(deviceToken), expiresAt: new Date(Date.now() + TRUST_MS) });
    jar.set(DEVICE_COOKIE, deviceToken, cookieOptions(TRUST_MS / 1000));
  }
  return { userId: counted.userId, membershipId: counted.membershipId, platformAdmin: !!counted.platformAdmin } as const;
}
