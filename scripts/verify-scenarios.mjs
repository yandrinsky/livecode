import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { io } from "socket.io-client";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const API = `${API_URL}/api`;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const password = "pairboard-test-123";
const db = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, expected = 200, ...options } = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status !== expected) {
    throw new Error(`${options.method ?? "GET"} ${path}: ожидался ${expected}, получен ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function register(kind, displayName) {
  const email = `${kind}-${runId}@pairboard.test`;
  const result = await request("/auth/register", {
    method: "POST",
    expected: 201,
    body: JSON.stringify({ email, password, displayName }),
  });
  assert(result.user.email === email, `Регистрация ${kind}: email не совпал`);
  return { ...result, email };
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Socket timeout: ${event}`));
    }, timeoutMs);
    const listener = (data) => {
      if (!predicate(data)) return;
      clearTimeout(timeout);
      socket.off(event, listener);
      resolve(data);
    };
    socket.on(event, listener);
  });
}

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Socket ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (data) => {
      clearTimeout(timeout);
      if (data?.error) reject(new Error(`${event}: ${data.error}`));
      else resolve(data);
    });
  });
}

async function connect(token) {
  const socket = io(API_URL, { auth: { token }, transports: ["websocket"], forceNew: true });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connect timeout")), 5000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
  return socket;
}

const checks = [];
function checked(name) {
  checks.push(name);
  console.log(`✓ ${name}`);
}

const sockets = [];
try {
  const health = await request("/health");
  assert(health.status === "ok", "Healthcheck вернул неверный статус");
  checked("API healthcheck");

  const student = await register("student", "Integration Student");
  const teacher = await register("teacher", "Integration Teacher");
  const outsider = await register("outsider", "Integration Outsider");
  checked("регистрация трёх независимых аккаунтов");

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: student.email, password }),
  });
  assert(login.user.id === student.user.id, "Login вернул другого пользователя");
  await request("/auth/me", { token: login.token });
  await request("/auth/login", {
    method: "POST",
    expected: 401,
    body: JSON.stringify({ email: student.email, password: "wrong-password" }),
  });
  checked("вход, /auth/me и отклонение неверного пароля");

  const { workspace } = await request("/workspaces", {
    token: student.token,
    method: "POST",
    expected: 201,
    body: JSON.stringify({ name: `Integration Workspace ${runId}` }),
  });
  assert(workspace.ownerId === student.user.id, "Неверный владелец workspace");
  checked("создание рабочего пространства");

  await request(`/workspaces/${workspace.id}`, { token: outsider.token, expected: 404 });
  const teacherBefore = await request("/workspaces", { token: teacher.token });
  assert(!teacherBefore.workspaces.some((item) => item.id === workspace.id), "Наставник получил доступ до приглашения");
  checked("изоляция workspace до приглашения");

  const { invite } = await request(`/workspaces/${workspace.id}/invites`, {
    token: student.token,
    method: "POST",
    expected: 201,
  });
  const inviteInfo = await request(`/invites/${invite.token}`, { token: teacher.token });
  assert(inviteInfo.invite.workspace.id === workspace.id, "Приглашение ведёт не в тот workspace");
  assert(!("email" in inviteInfo.invite), "Одноразовое приглашение не должно содержать email");
  const accepted = await request(`/invites/${invite.token}/accept`, { token: teacher.token, method: "POST" });
  assert(accepted.workspaceId === workspace.id, "Accept вернул другой workspace");
  await request(`/invites/${invite.token}/accept`, { token: outsider.token, method: "POST", expected: 404 });
  checked("приглашение без email и одноразовое принятие первым аккаунтом");

  const teacherAfter = await request("/workspaces", { token: teacher.token });
  assert(teacherAfter.workspaces.some((item) => item.id === workspace.id), "Workspace не появился у наставника");
  checked("доступ наставника после приглашения");

  const { board } = await request(`/workspaces/${workspace.id}/boards`, {
    token: student.token,
    method: "POST",
    expected: 201,
    body: JSON.stringify({
      title: "Integration TypeScript Board",
      description: "Проверка полного пользовательского сценария",
      groupName: "Integration",
      language: "TYPESCRIPT",
    }),
  });
  const { board: jsBoard } = await request(`/workspaces/${workspace.id}/boards`, {
    token: teacher.token,
    method: "POST",
    expected: 201,
    body: JSON.stringify({ title: "Integration JavaScript Board", groupName: "Integration", language: "JAVASCRIPT" }),
  });
  assert(board.content.includes("number[]"), "TS starter не соответствует языку");
  assert(jsBoard.content.includes("solve(input)"), "JS starter не соответствует языку");
  checked("создание и сохранение TS/JS-досок в группе");

  const patched = await request(`/boards/${board.id}`, {
    token: teacher.token,
    method: "PATCH",
    body: JSON.stringify({ title: "Integration Board Renamed", groupName: "Arrays" }),
  });
  assert(patched.board.title === "Integration Board Renamed", "Наставник не смог обновить доску");
  await request(`/boards/${board.id}`, { token: outsider.token, expected: 404 });
  await request(`/boards/${board.id}`, { token: teacher.token, method: "DELETE", expected: 403 });
  checked("редактирование участником и запрет доступа/удаления без прав владельца");

  const studentSocket = await connect(student.token);
  const teacherSocket = await connect(teacher.token);
  sockets.push(studentSocket, teacherSocket);
  checked("Socket.IO авторизация двух участников");

  const invalidSocket = io(API_URL, { auth: { token: "invalid-token" }, transports: ["websocket"], forceNew: true });
  const invalidError = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Неавторизованный socket не был отклонён вовремя")), 5000);
    invalidSocket.once("connect", () => { clearTimeout(timeout); reject(new Error("Неавторизованный socket подключился")); });
    invalidSocket.once("connect_error", (error) => { clearTimeout(timeout); resolve(error); });
  });
  assert(invalidError.message === "unauthorized", "Socket вернул неожиданную auth-ошибку");
  invalidSocket.disconnect();
  checked("отклонение Socket.IO подключения с неверным JWT");

  await emitAck(studentSocket, "workspace:join", workspace.id);
  const twoPresent = waitFor(studentSocket, "presence:update", (users) => users.length === 2);
  await emitAck(teacherSocket, "workspace:join", workspace.id);
  const workspacePresence = await twoPresent;
  assert(new Set(workspacePresence.map((user) => user.id)).size === 2, "Presence не содержит двух уникальных пользователей");
  checked("presence двух участников в workspace");

  await emitAck(studentSocket, "board:join", board.id);
  const boardPresencePromise = waitFor(studentSocket, "presence:update", (users) => users.length === 2);
  await emitAck(teacherSocket, "board:join", board.id);
  await boardPresencePromise;

  const collaborativeCode = `export function solve(values: number[]) {\n  return values.reduce((sum, value) => sum + value, 0);\n}\nconsole.log(solve([1, 2, 3]));\n// ${runId}`;
  const remoteChange = waitFor(teacherSocket, "board:change", (change) => change.boardId === board.id && change.content === collaborativeCode);
  const saved = waitFor(studentSocket, "board:saved", (state) => state.version > board.version);
  studentSocket.emit("board:change", { boardId: board.id, content: collaborativeCode });
  const [change, saveState] = await Promise.all([remoteChange, saved]);
  assert(change.user.id === student.user.id, "board:change содержит неверного автора");
  assert(saveState.version > board.version, "Версия доски не увеличилась");
  const persisted = await request(`/boards/${board.id}`, { token: teacher.token });
  assert(persisted.board.content === collaborativeCode, "Realtime-код не сохранился в PostgreSQL");
  checked("совместное изменение кода, broadcast, версия и persistence");

  const selection = { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 16 };
  const remoteSelection = waitFor(teacherSocket, "board:selection", (event) =>
    event.boardId === board.id && event.user.id === student.user.id && event.selection.endColumn === selection.endColumn
  );
  studentSocket.emit("board:selection", { boardId: board.id, selection });
  const awareness = await remoteSelection;
  assert(awareness.clientId === studentSocket.id, "Selection awareness содержит неверный clientId");

  let invalidSelectionWasBroadcast = false;
  const invalidListener = () => { invalidSelectionWasBroadcast = true; };
  teacherSocket.on("board:selection", invalidListener);
  studentSocket.emit("board:selection", { boardId: board.id, selection: { ...selection, startLineNumber: -1 } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  teacherSocket.off("board:selection", invalidListener);
  assert(!invalidSelectionWasBroadcast, "Сервер ретранслировал невалидное выделение");
  checked("синхронизация и серверная валидация выделения текста");

  const runningPromise = waitFor(teacherSocket, "pomodoro:update", (timer) => timer.workspaceId === workspace.id && timer.status === "RUNNING");
  studentSocket.emit("pomodoro:action", { workspaceId: workspace.id, action: "start", durationSeconds: 120 });
  const running = await runningPromise;
  assert(running.durationSeconds === 120 && running.endsAt, "Pomodoro стартовал с неверными данными");
  const pausedPromise = waitFor(studentSocket, "pomodoro:update", (timer) => timer.workspaceId === workspace.id && timer.status === "PAUSED");
  teacherSocket.emit("pomodoro:action", { workspaceId: workspace.id, action: "pause" });
  const paused = await pausedPromise;
  assert(paused.remainingSeconds > 0 && paused.remainingSeconds <= 120, "Pomodoro pause сохранил неверный остаток");
  const resetPromise = waitFor(teacherSocket, "pomodoro:update", (timer) => timer.workspaceId === workspace.id && timer.status === "IDLE");
  studentSocket.emit("pomodoro:action", { workspaceId: workspace.id, action: "reset", durationSeconds: 300 });
  const reset = await resetPromise;
  assert(reset.remainingSeconds === 300, "Pomodoro reset не применил длительность");
  checked("общий Pomodoro: start → pause → reset с разных клиентов");

  await emitAck(studentSocket, "pomodoro:action", { workspaceId: workspace.id, action: "start" });
  await db.pomodoro.update({ where: { workspaceId: workspace.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  const breakUpdatePromise = waitFor(teacherSocket, "pomodoro:update", (timer) => timer.workspaceId === workspace.id && timer.phase === "BREAK");
  const focusCompletedPromise = waitFor(teacherSocket, "pomodoro:completed", (event) => event.workspaceId === workspace.id && event.completedPhase === "FOCUS");
  await emitAck(studentSocket, "pomodoro:complete", workspace.id);
  const [breakTimer] = await Promise.all([breakUpdatePromise, focusCompletedPromise]);
  assert(breakTimer.status === "RUNNING" && breakTimer.remainingSeconds === 300, "После фокуса не запустился пятиминутный перерыв");
  const activityBeforeBreak = await db.boardActivityMinute.count({ where: { userId: student.user.id } });
  await request(`/boards/${board.id}/activity`, { token: student.token, method: "POST", expected: 204 });
  const activityAfterBreak = await db.boardActivityMinute.count({ where: { userId: student.user.id } });
  assert(activityAfterBreak === activityBeforeBreak, "Перерыв ошибочно попал в статистику активности");

  await db.pomodoro.update({ where: { workspaceId: workspace.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  const focusReadyPromise = waitFor(teacherSocket, "pomodoro:update", (timer) => timer.workspaceId === workspace.id && timer.phase === "FOCUS" && timer.status === "IDLE");
  await emitAck(studentSocket, "pomodoro:complete", workspace.id);
  const focusReady = await focusReadyPromise;
  assert(focusReady.remainingSeconds === 300, "После перерыва не восстановилась длительность фокус-сессии");
  checked("Pomodoro: фокус → перерыв 5 минут → фокус, перерыв не входит в статистику");

  await request(`/boards/${jsBoard.id}`, { token: student.token, method: "DELETE", expected: 204 });
  const finalWorkspace = await request(`/workspaces/${workspace.id}`, { token: teacher.token });
  assert(finalWorkspace.workspace.boards.some((item) => item.id === board.id), "Основная доска потеряна");
  assert(!finalWorkspace.workspace.boards.some((item) => item.id === jsBoard.id), "Удалённая доска осталась в списке");
  assert(finalWorkspace.workspace.pomodoro.remainingSeconds === 300, "Pomodoro не сохранился в БД");
  checked("удаление владельцем и итоговое состояние workspace");

  const selectionClear = waitFor(studentSocket, "board:selection-clear", (event) => event.boardId === board.id && event.clientId === teacherSocket.id);
  const boardLeavePresence = waitFor(studentSocket, "presence:update", (users) => users.length === 1 && users[0]?.id === student.user.id);
  teacherSocket.emit("board:leave", board.id);
  await Promise.all([selectionClear, boardLeavePresence]);
  const workspaceLeavePresence = waitFor(studentSocket, "presence:update", (users) => users.length === 1 && users[0]?.id === student.user.id);
  teacherSocket.emit("workspace:leave", workspace.id);
  await workspaceLeavePresence;
  checked("очистка presence при выходе из board/workspace комнат");

  const { invite: racingInvite } = await request(`/workspaces/${workspace.id}/invites`, {
    token: student.token,
    method: "POST",
    expected: 201,
  });
  const racingResults = await Promise.allSettled([
    request(`/invites/${racingInvite.token}/accept`, { token: teacher.token, method: "POST" }),
    request(`/invites/${racingInvite.token}/accept`, { token: outsider.token, method: "POST" }),
  ]);
  assert(racingResults.filter((result) => result.status === "fulfilled").length === 1, "Одновременное принятие должно дать доступ ровно одному аккаунту");
  assert(racingResults.filter((result) => result.status === "rejected").length === 1, "Второй одновременный запрос должен быть отклонён");
  await request(`/invites/${racingInvite.token}`, { token: student.token, expected: 404 });
  checked("атомарное одноразовое принятие при конкурирующих запросах");

  console.log(`\nВсе сценарии пройдены: ${checks.length}. Workspace: ${workspace.id}, Board: ${board.id}`);
} finally {
  for (const socket of sockets) socket.disconnect();
  await db.$disconnect();
}
