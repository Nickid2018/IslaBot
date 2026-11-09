-- CreateTable
CREATE TABLE "minecraft_server" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "endpoint" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "operators" JSONB NOT NULL DEFAULT [],
    "credential" TEXT
);

-- CreateTable
CREATE TABLE "minecraft_server_scope" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt_name" TEXT,
    "server_id" INTEGER NOT NULL,
    CONSTRAINT "minecraft_server_scope_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "minecraft_server" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "minecraft_server_endpoint_key" ON "minecraft_server"("endpoint");

-- CreateIndex
CREATE INDEX "minecraft_server_endpoint_idx" ON "minecraft_server"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "minecraft_server_scope_scope_name_key" ON "minecraft_server_scope"("scope", "name");
