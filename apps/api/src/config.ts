import "dotenv/config";

const jwtSecret = process.env.JWT_SECRET ?? "local-development-secret";
if (process.env.NODE_ENV === "production" && jwtSecret === "local-development-secret") {
  throw new Error("JWT_SECRET is required in production");
}

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  jwtSecret,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
};

