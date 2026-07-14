CREATE TABLE "BoardActivityMinute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardActivityMinute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardActivityMinute_userId_minute_key" ON "BoardActivityMinute"("userId", "minute");
CREATE INDEX "BoardActivityMinute_boardId_minute_idx" ON "BoardActivityMinute"("boardId", "minute");

ALTER TABLE "BoardActivityMinute" ADD CONSTRAINT "BoardActivityMinute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardActivityMinute" ADD CONSTRAINT "BoardActivityMinute_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
