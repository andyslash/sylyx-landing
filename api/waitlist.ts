import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID!;

// Disposable email domains — extend as needed
const DISPOSABLE_DOMAINS = new Set([
  "tempmail.com",
  "guerrillamail.com",
  "guerrillamail.de",
  "throwaway.email",
  "mailinator.com",
  "yopmail.com",
  "trashmail.com",
  "dispostable.com",
  "sharklasers.com",
  "guerrillamailblock.com",
  "grr.la",
  "temp-mail.org",
  "fakeinbox.com",
  "10minutemail.com",
  "mohmal.com",
  "maildrop.cc",
  "getairmail.com",
]);

// Simple in-memory rate limiter (per Vercel function instance)
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 3; // 3 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_MAX;
}

function isValidEmail(email: string): boolean {
  // RFC 5322 simplified — good enough for real-world validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limiting
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }

  const { email, website } = req.body ?? {};

  // Honeypot — "website" field should be empty (hidden from humans)
  if (website) {
    // Pretend success to not tip off bots
    return res.status(200).json({ ok: true });
  }

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  if (isDisposableEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Please use a permanent email address." });
  }

  try {
    const { error } = await resend.contacts.create({
      audienceId: AUDIENCE_ID,
      email: normalizedEmail,
      unsubscribed: false,
    });

    // Resend returns an error for duplicates — treat as success
    if (error && !error.message?.toLowerCase().includes("already exists")) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
