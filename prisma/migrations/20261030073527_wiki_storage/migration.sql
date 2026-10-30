-- CreateTable
CREATE TABLE "start_wikis" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "start" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "scope_interwikis" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "url" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "scope_interwikis_scope_prefix_key" ON "scope_interwikis"("scope", "prefix");
