import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("pairboard123", 12);
  const student = await db.user.upsert({ where: { email: "student@pairboard.local" }, update: {}, create: { email: "student@pairboard.local", displayName: "Алексей, ученик", passwordHash } });
  const teacher = await db.user.upsert({ where: { email: "teacher@pairboard.local" }, update: {}, create: { email: "teacher@pairboard.local", displayName: "Марина, наставник", passwordHash } });
  const existing = await db.workspace.findFirst({ where: { ownerId: student.id, name: "Алгоритмы · лето" } });
  if (!existing) {
    await db.workspace.create({
      data: {
        name: "Алгоритмы · лето",
        ownerId: student.id,
        members: { create: [{ userId: student.id, role: "OWNER" }, { userId: teacher.id, role: "MEMBER" }] },
        pomodoro: { create: {} },
        boards: {
          create: [
            { title: "Два указателя", description: "Найти пару с заданной суммой за O(n).", groupName: "Массивы", language: "TYPESCRIPT", createdById: student.id, content: "export function twoSum(nums: number[], target: number) {\n  const seen = new Map<number, number>();\n\n  // продолжи решение\n  return [];\n}\n" },
            { title: "Скобочная последовательность", description: "Проверить корректность вложенности скобок.", groupName: "Стек", language: "JAVASCRIPT", createdById: student.id, content: "export function isValid(source) {\n  const stack = [];\n  // твое решение\n}\n" },
          ],
        },
      },
    });
  }
  console.log("Demo: student@pairboard.local / teacher@pairboard.local, password pairboard123");
}

main().finally(() => db.$disconnect());
