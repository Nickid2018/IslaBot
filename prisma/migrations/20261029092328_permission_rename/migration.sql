/*
  Warnings:

  - You are about to drop the `Permissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Permissions";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL
);
