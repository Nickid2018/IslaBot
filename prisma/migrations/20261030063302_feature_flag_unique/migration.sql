/*
  Warnings:

  - A unique constraint covering the columns `[scope,feature]` on the table `feature_enables` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "feature_enables_scope_feature_key" ON "feature_enables"("scope", "feature");
