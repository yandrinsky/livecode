import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { config } from "./config.js";
import { routes } from "./routes.js";
import { attachRealtime } from "./realtime.js";

const app = express();
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/api", routes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ message: error.issues[0]?.message ?? "Проверьте введённые данные", issues: error.issues });
  console.error(error);
  res.status(500).json({ message: "Внутренняя ошибка сервера" });
});

const server = createServer(app);
attachRealtime(server);
server.listen(config.port, () => console.log(`Pairboard API: http://localhost:${config.port}`));

