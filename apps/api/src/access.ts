import { db } from "./db.js";

export async function workspaceAccess(workspaceId: string, userId: string) {
  return db.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
}

export async function boardAccess(boardId: string, userId: string) {
  return db.board.findFirst({
    where: {
      id: boardId,
      workspace: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    },
  });
}

