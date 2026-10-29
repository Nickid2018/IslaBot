/*
  Warnings:

  - You are about to drop the column `endAt` on the `Permissions` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL
);
INSERT INTO "new_Permissions" ("id", "level") SELECT "id", "level" FROM "Permissions";
DROP TABLE "Permissions";
ALTER TABLE "new_Permissions" RENAME TO "Permissions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
