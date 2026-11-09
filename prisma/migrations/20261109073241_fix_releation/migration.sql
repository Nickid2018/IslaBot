-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_minecraft_server_scope" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt_name" TEXT,
    "server_id" INTEGER NOT NULL,
    CONSTRAINT "minecraft_server_scope_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "minecraft_server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_minecraft_server_scope" ("alt_name", "id", "name", "scope", "server_id") SELECT "alt_name", "id", "name", "scope", "server_id" FROM "minecraft_server_scope";
DROP TABLE "minecraft_server_scope";
ALTER TABLE "new_minecraft_server_scope" RENAME TO "minecraft_server_scope";
CREATE UNIQUE INDEX "minecraft_server_scope_scope_name_key" ON "minecraft_server_scope"("scope", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
