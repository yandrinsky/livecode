import "dotenv/config";

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "local-development-secret",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
};

