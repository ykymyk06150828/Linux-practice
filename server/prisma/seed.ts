import * as argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminPass = await argon2.hash("admin123");
  const learnerPass = await argon2.hash("learner123");

  await prisma.user.upsert({
    where: { loginId: "admin" },
    update: {},
    create: {
      loginId: "admin",
      userName: "管理者",
      passwordHash: adminPass,
      role: "admin",
      status: "active",
    },
  });

  const learner = await prisma.user.upsert({
    where: { loginId: "learner" },
    update: {},
    create: {
      loginId: "learner",
      userName: "受講者",
      passwordHash: learnerPass,
      role: "learner",
      status: "active",
    },
  });

  let course = await prisma.course.findFirst({
    where: { courseName: "Linux 基礎" },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        courseName: "Linux 基礎",
        description: "コマンドライン演習（初期データ）",
        status: "active",
      },
    });
  }

  const existingTask = await prisma.task.findFirst({
    where: { courseId: course.id, taskName: "はじめてのシェル" },
  });
  if (!existingTask) {
    await prisma.task.create({
      data: {
        courseId: course.id,
        taskName: "はじめてのシェル",
        description: "pwd / ls / cd を試してください。",
        displayOrder: 1,
      },
    });
  }

  await prisma.userCourseEnrollment.upsert({
    where: {
      userId_courseId: { userId: learner.id, courseId: course.id },
    },
    update: {},
    create: {
      userId: learner.id,
      courseId: course.id,
    },
  });

  console.log("seed done: admin / learner (passwords: admin123 / learner123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
