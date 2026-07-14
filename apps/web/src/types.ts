export type User = { id: string; email: string; displayName: string };
export type Pomodoro = { workspaceId: string; status: "IDLE" | "RUNNING" | "PAUSED"; durationSeconds: number; remainingSeconds: number; startedAt: string | null; endsAt: string | null; updatedAt: string };
export type Board = { id: string; workspaceId: string; title: string; description: string; groupName: string | null; language: "TYPESCRIPT" | "JAVASCRIPT"; content: string; version: number; createdAt: string; updatedAt: string; createdBy?: { id: string; displayName: string } };
export type Workspace = { id: string; name: string; ownerId: string; owner: User; boards?: Board[]; members?: { role: "OWNER" | "MEMBER"; user: User }[]; pomodoro?: Pomodoro; _count?: { boards: number; members: number }; createdAt: string; updatedAt: string };

